const {
	Kind,
	getNamedType,
	GraphQLObjectType,
	GraphQLInterfaceType,
} = require('graphql');
const { getArgumentValues } = require('graphql/execution/values');
const { CostValidationError } = require('./error');
const { get, sum } = require('lodash');
const reservedLeafs = ['node', 'edges'];

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
			throw new CostValidationError('Unsupported operation', {
				operation,
			});
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
		if (arg.kind !== Kind.ARGUMENT) {
			continue;
		}

		if (arg.value.kind === Kind.INT) {
			multiplierValues[arg.name.value] = parseInt(arg.value.value, 10);
		} else if (arg.value.kind === Kind.LIST) {
			multiplierValues[arg.name.value] = arg.value.values.length;
		}
	}

	for (const multiplier of multipliers) {
		if (!isNaN(multiplier)) {
			multiplierValues[`${multiplier}`] = multiplier;
		}
	}

	return sum(multipliers.map((key) => multiplierValues[`${key}`]));
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

	// have to return field * parent multiplier as the parent multiplier for the next nested field
	let totalMultiplier = getFieldMultiplier(ast, multipliers, fieldArgValues);
	let fieldCost = complexity;

	if (useMultipliers && parentMultiplier > 0) {
		totalMultiplier =
			(totalMultiplier > 0 ? totalMultiplier : 1) * parentMultiplier;
	}

	if (totalMultiplier > 0) {
		fieldCost = fieldCost * totalMultiplier;
	}

	if (tokens && useMultipliers && parentMultiplier > 0) {
		fieldCost = fieldCost + tokens * parentMultiplier;
	} else if (tokens) {
		fieldCost = fieldCost + tokens;
	}

	return [fieldCost, totalMultiplier];
}

module.exports = function CostVisitor(
	validationContext,
	{ costMap, defaultCost = 1, variables, debug = false }
) {
	let totalCost = 0;
	let debugLog = ``;
	let depth = 0;

	const visitor = {
		OperationDefinition: {
			enter(operationDefNode) {
				const typeDefs = getOperationTypeDefs(
					validationContext.getSchema(),
					operationDefNode.operation
				);
				const nodeCost = getNodeCost(operationDefNode, typeDefs);

				totalCost = totalCost + nodeCost;
			},
			leave() {
				if (debug) {
					// eslint-disable-next-line
					console.log(debugLog);
				}
				// if used with graphql built-in validation then
				// implement throwing error if maxCost has been exceeded
				// if (this.cost > this.options.maximumCost) {
				//   return validationContext.reportError(new CostValidationError(`Max cost exceeded`))
				// }
			},
		},
	};

	function getFieldCostProps(baseName, fieldName) {
		const defaultCostProps = {
			complexity: defaultCost,
			multipliers: [],
			useMultipliers: false,
			provides: [],
			tokens: 0,
		};
		const props = get(costMap, `${baseName}.${fieldName}`);

		return props
			? // if cost props are defined, use mutliplers by default
			  { ...defaultCostProps, useMultipliers: true, ...props }
			: // if cost props are not defined, don't use multipliers
			  defaultCostProps;
	}

	function getAST(ast) {
		if (ast.kind === 'FragmentSpread') {
			const fragmentName = ast.name.value;

			return validationContext.getFragment(fragmentName);
		}

		return ast;
	}

	function getASTAndTypeDefs(ast) {
		if (!isFragment(ast)) {
			return { ast };
		}

		ast = getAST(ast);

		return {
			ast,
			typeDefs: validationContext
				.getSchema()
				.getType(ast.typeCondition.name.value),
		};
	}

	function onlyAvailabeFieldsInSelection(ast, availableFields) {
		if (!availableFields.length || !getSelections(ast).length) {
			return false;
		}

		const available = new Set(availableFields).add('__typename');

		function checkAvailable(selections = []) {
			for (let ast of selections) {
				ast = getAST(ast);

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

	function getRecursion(AST, recursionMultiplier = 100) {
		if (reservedLeafs.includes(AST.name.value)) {
			return 1;
		}

		const dupes = AST.fullpath.filter((item) => item === AST.name.value)
			.length;

		if (dupes) {
			logCostDebug(
				`recursion detected ${AST.fullpath.reverse().join('.')}=>${
					AST.name.value
				} for ${dupes} times`,
				depth
			);

			return Math.pow(recursionMultiplier, dupes);
		}

		return 1;
	}

	function logCostDebug(line, depth = 0) {
		if (debug) {
			debugLog = `${debugLog}\n${' '.repeat(depth)}${line}`;
		}
	}

	function buildFullPath(AST) {
		return AST.name && AST.name.value
			? [...AST.fullpath, AST.name.value]
			: AST.fullpath;
	}

	// eslint-disable-next-line complexity
	function getNodeCost(
		parentAST,
		parentTypeDefs,
		parentMultiplier,
		recursionMultiplier = 100
	) {
		let nodeCost = 0;

		depth++;
		logCostDebug(
			`${parentAST.name ? parentAST.name.value : ''} ${parentAST.kind}`,
			depth
		);

		depth++;

		parentAST.fullpath = parentAST.fullpath || [];

		for (const childAST of parentAST.selectionSet.selections) {
			if (isFragment(childAST)) {
				logCostDebug(
					`...${childAST.name ? childAST.name.value : ''} <${
						childAST.kind
					}>`,
					depth
				);

				const { ast: fragmentAst, typeDefs } = getASTAndTypeDefs(
					childAST
				);

				fragmentAst.parent = parentAST;
				fragmentAst.fullpath = buildFullPath(parentAST);

				nodeCost =
					nodeCost +
					getNodeCost(
						fragmentAst,
						typeDefs,
						parentMultiplier,
						recursionMultiplier
					);

				continue;
			} else {
				childAST.fullpath = buildFullPath(parentAST);

				// we should link Field nodes with parenting fragment spreads to be able to determine the recursion
				if (parentAST.name && parentAST.name.value) {
					childAST.parent = parentAST;
				}

				logCostDebug(
					`${childAST.name.value} <${childAST.kind}>`,
					depth
				);
			}

			// fragment spread does not have a name
			const costProps = getFieldCostProps(
				parentTypeDefs && parentTypeDefs.name
					? parentTypeDefs.name
					: null,
				childAST.name.value
			);

			// reset recursion multiplier to be set for all child props instead of default one
			if (costProps.recursionMultiplier) {
				recursionMultiplier = costProps.recursionMultiplier;
			}

			const { fieldType, fieldArgValues } = getFieldInfo(
				parentTypeDefs,
				childAST,
				variables
			);

			const fieldCost = getFieldCost({
				onlyAvailabeFieldsInSelection,
				childAST,
				costProps,
				fieldArgValues,
				parentMultiplier,
				fieldType,
				recursionMultiplier,
			});

			logCostDebug(`= ${fieldCost}`, depth);
			nodeCost = nodeCost + fieldCost;
		}

		depth--;
		logCostDebug(`== ${nodeCost}`, depth);
		depth--;

		return nodeCost;
	}

	function getFieldCost({
		onlyAvailabeFieldsInSelection,
		childAST,
		costProps,
		fieldArgValues,
		parentMultiplier,
		fieldType,
		recursionMultiplier,
	}) {
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
			const appliedRecursionMultiplier = getRecursion(
				childAST,
				recursionMultiplier
			);

			if (appliedRecursionMultiplier > 1) {
				logCostDebug(
					`* recursion multiplier = (${appliedRecursionMultiplier})`,
					depth
				);
			}

			const childCost = getNodeCost(
				childAST,
				fieldType,
				multiplier || parentMultiplier,
				recursionMultiplier
			);

			fieldCost = (fieldCost + childCost) * appliedRecursionMultiplier;
		}

		return fieldCost;
	}

	return {
		visitor,
		getCurrentCost: () => totalCost,
	};
};
