const {
	Kind,
	getNamedType,
	GraphQLObjectType,
	GraphQLInterfaceType,
} = require('graphql');
const { getArgumentValues } = require('graphql/execution/values');
const { get, sum } = require('lodash');

function getSelections(ast) {
	return get(ast, 'selectionSet.selections', []);
}

function isFragment(ast) {
	return (
		ast.kind === Kind.INLINE_FRAGMENT ||
		ast.kind === Kind.FRAGMENT_SPREAD ||
		ast.kind === Kind.FRAGMENT_DEFINITION
	);
}

function getOperationTypeDefs(schema, operation) {
	switch (operation) {
		case 'query':
			return schema.getQueryType();
		case 'mutation':
			return schema.getMutationType();
		case 'subscription':
			return schema.getSubscriptionType();
		default:
			throw new Error('Unsupported operation: ' + operation);
	}
}

function getFieldMultiplier(ast, multipliers = [], fieldArgValues) {
	if (!multipliers.length) {
		return 0;
	}

	const multiplierValues = {};

	for (const [key, value] of Object.entries(fieldArgValues || {})) {
		if (Array.isArray(value)) {
			multiplierValues[key] = value.length;
		} else if (!isNaN(value)) {
			multiplierValues[key] = value;
		}
	}

	for (const arg of ast.arguments) {
		if (arg.kind === Kind.ARGUMENT) {
			if (arg.value.kind === Kind.INT) {
				multiplierValues[arg.name.value] = parseInt(arg.value.value, 10);
			} else if (arg.value.kind === Kind.LIST) {
				multiplierValues[arg.name.value] = arg.value.values.length;
			}
		}
	}

	return sum(multipliers.map((key) => multiplierValues[key]));
}

function getFieldInfo(typeDefs, ast, variables) {
	let fields = {};

	if (
		typeDefs instanceof GraphQLObjectType ||
		typeDefs instanceof GraphQLInterfaceType
	) {
		fields = typeDefs.getFields();
	}

	const field = fields[ast.name.value];
	const fieldType = field ? getNamedType(field.type) : null;
	const fieldArgValues = field
		? getArgumentValues(field, ast, variables)
		: null;

	return { fieldType, fieldArgValues };
}

function computeFieldCost(
	costProps,
	ast,
	fieldArgValues,
	parentMultiplier = 0
) {
	const { useMultipliers, multipliers, complexity, tokens } = costProps;

	let fieldMultipler = getFieldMultiplier(ast, multipliers, fieldArgValues);
	let fieldCost = complexity;

	if (useMultipliers && parentMultiplier > 0) {
		fieldMultipler =
			(fieldMultipler > 0 ? fieldMultipler : 1) * parentMultiplier;
	}

	if (fieldMultipler > 0) {
		fieldCost = fieldCost * fieldMultipler;
	}

	/**
	 * as tokens have a high cost(100), we only use parent multiplers
	 * if fields own multiplers would be used, then for query `deals(limit: 100) @cost(multipliers: ["limit"])`
	 * the cost would already be 100 * 100 = 10000
	 * idea of tokens is to define "what it takes" to execute the query
	 * parent multipliers are used because it takes "parent" times to execute the query
	 */
	if (tokens && useMultipliers && parentMultiplier > 0) {
		fieldCost = fieldCost + tokens * parentMultiplier;
	} else if (tokens) {
		fieldCost = fieldCost + tokens;
	}

	return [fieldCost, fieldMultipler];
}

module.exports = function CostVisitor(
	validationContext,
	{ costMap, defaultCost = 1, variables }
) {
	const defaultCostProps = {
		complexity: defaultCost,
		multipliers: [],
		useMultipliers: false,
		provides: [],
		tokens: 0,
	};
	let totalCost = 0;

	const visitor = {
		OperationDefinition: {
			enter(operationDefNode) {
				const typeDefs = getOperationTypeDefs(
					validationContext.getSchema(),
					operationDefNode.operation
				);

				totalCost = totalCost + getNodeCost(operationDefNode, typeDefs);
			},
			leave() {
				// if used with graphql built-in validation then
				// implement throwing error if maxCost has been exceeded
				// if (this.cost > this.options.maximumCost) {
				//   return validationContext.reportError(new Error(`Max cost exceeded`))
				// }
			},
		},
	};

	function getFieldCostProps(baseName, fieldName) {
		const fieldProps = get(costMap, `${baseName}.${fieldName}`);
		const result = { ...defaultCostProps };

		if (fieldProps) {
			Object.assign(result, { useMultipliers: true, ...fieldProps })
		}

		return result;
	}

	function getASTFromFragment(ast) {
		if (ast.kind === 'FragmentSpread') {
			const fragmentName = ast.name.value;

			return validationContext.getFragment(fragmentName);
		}

		return ast;
	}

	function getASTAndTypeDefs(ast) {
		if (isFragment(ast)) {
			const fragmentAST = getASTFromFragment(ast);

			return {
				ast: fragmentAST,
				typeDefs: validationContext
					.getSchema()
					.getType(fragmentAST.typeCondition.name.value),
			};
		}

		return { ast };		
	}

	function onlyAvailabeFieldsInSelection(ast, availableFields) {
		if (!availableFields.length || !getSelections(ast).length) {
			return false;
		}

		const available = new Set(availableFields).add('__typename');

		function checkAvailable(selections = []) {
			for (const selection of selections) {
				const ast = getASTFromFragment(selection);

				if (isFragment(ast) && !checkAvailable(getSelections(ast))) {
					return false;
				}

				if (!available.has(ast.name.value)) {
					return false;
				}
			}

			return true;
		}

		return checkAvailable(getSelections(ast));
	}

	function getFirstNonFragment(AST) {
		if (!AST.parent) {
			return AST;
		}

		return getFirstNonFragment(AST.parent);
	}

	function getRecursion(recursionMap, parentAST, childAST) {
		const parent = getFirstNonFragment(parentAST);

		if (!parent.name) {
			return [1];
		}

		recursionMap = recursionMap || new Map();

		const appearances =
			(recursionMap.get(`${parent.name.value}=>${childAST.name.value}`) ||
				0) + 1;

		recursionMap.set(
			`${parent.name.value}=>${childAST.name.value}`,
			appearances
		);
		recursionMap.set(
			`${childAST.name.value}=>${parent.name.value}`,
			appearances
		);

		const recursionLevel = appearances - 1;

		if (recursionLevel < 2) {
			return [1, recursionMap];
		}

		return [Math.pow(100, recursionLevel), recursionMap];
	}

	function getNodeCost(
		parentAST,
		parentTypeDefs,
		parentMultiplier,
		recursions
	) {
		let nodeCost = 0;

		for (const childAST of parentAST.selectionSet.selections) {
			if (isFragment(childAST)) {
				const { ast: fragmentAst, typeDefs } = getASTAndTypeDefs(
					childAST
				);

				fragmentAst.parent = parentAST;

				nodeCost = nodeCost + getNodeCost(
					fragmentAst,
					typeDefs,
					parentMultiplier,
					recursions
				);

				continue;
			}

			// fragment spread does not have a name
			const costProps = getFieldCostProps(
				parentTypeDefs && parentTypeDefs.name
					? parentTypeDefs.name
					: null,
				childAST.name.value
			);
			const { fieldType, fieldArgValues } = getFieldInfo(
				parentTypeDefs,
				childAST,
				variables
			);

			let fieldCost, multiplier;

			if (onlyAvailabeFieldsInSelection(childAST, costProps.provides)) {
				fieldCost = 1;
				multiplier = 0;
			} else {
				[fieldCost, multiplier] = computeFieldCost(
					costProps,
					childAST,
					fieldArgValues,
					parentMultiplier
				);
			}

			if (childAST.selectionSet) {
				// don't share the mappings between root nodes
				const [recursionMutliplier, recursionsMap] = getRecursion(
					recursions,
					parentAST,
					childAST
				);
				const childCost = getNodeCost(
					childAST,
					fieldType,
					multiplier || parentMultiplier,
					recursionsMap
				);
				console.log({fieldCost, childCost, name: `${parentAST.name && parentAST.name.value}=>${childAST.name && childAST.name.value}`})

				fieldCost = (fieldCost + childCost) * recursionMutliplier;
			}
			console.log({fieldCost, name: `${parentAST.name && parentAST.name.value}=>${childAST.name && childAST.name.value}`})

			nodeCost = nodeCost + fieldCost;
		}

		return nodeCost;
	}

	return {
		visitor,
		getCurrentCost: () => totalCost,
	};
};
