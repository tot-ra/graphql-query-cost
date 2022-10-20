const { parse, print } = require('graphql');
const _ = require('lodash');

const complexityTokens = {
	network: 100,
	db: 100,
};

function getArgumentValue(value) {
	const simpleKinds = new Set(['IntValue', 'BooleanValue', 'StringValue']);

	if (simpleKinds.has(value.kind)) {
		if (value.kind === 'IntValue') {
			return parseInt(value.value, 10);
		}

		return value.value;
	}

	if (value.kind === 'ListValue') {
		return value.values.map(getArgumentValue);
	}
}

function getDirectiveArguments(directive, argValidators) {
	const result = {};

	for (const arg of directive.arguments) {
		const validator = argValidators[arg.name.value];
		const value = getArgumentValue(arg.value);

		if (validator && validator(value)) {
			const token = complexityTokens[arg.name.value];

			if (token) {
				result.tokens = value * token + (result.tokens || 0);
			} else {
				result[arg.name.value] = value;
			}
		}
	}

	return result;
}

function loopFieldDirectiveNodes(documentNode, directiveName, handler) {
	const definitionsWithFields = new Set([
		'ObjectTypeDefinition',
		'ObjectTypeExtension',
	]);

	documentNode.definitions.forEach((definition) => {
		if (!definitionsWithFields.has(definition.kind)) {
			return;
		}

		definition.fields.forEach((field) => {
			field.directives.forEach((directive, index) => {
				if (directive.name.value !== directiveName) {
					return;
				}

				handler({
					directive,
					index,
					directives: field.directive,
					field,
					definition,
				});
			});
		});
	});
}

function getDirectiveArgumentValues(
	documentNode,
	directiveName,
	argValidators
) {
	const argumentMap = {};

	loopFieldDirectiveNodes(
		documentNode,
		directiveName,
		({ directive, definition, field }) => {
			const args = getDirectiveArguments(directive, argValidators);

			if (args && Object.keys(args).length) {
				_.set(
					argumentMap,
					`${definition.name.value}.${field.name.value}`,
					args
				);
			}
		}
	);

	return argumentMap;
}

function removeDirectives(documentNode, directiveName) {
	loopFieldDirectiveNodes(documentNode, directiveName, ({ index, field }) => {
		field.directives.splice(index, 1);
	});
}

function removeDefinitions(documentNode, kind, name) {
	documentNode.definitions.forEach((definition, i) => {
		if (definition.kind !== kind || definition.name.value !== name) {
			return;
		}

		documentNode.definitions.splice(i, 1);
	});
}

function extractDirectiveValues(typeDefs, directive, argValidators) {
	const documentNode = parse(typeDefs);
	const costMap = getDirectiveArgumentValues(
		documentNode,
		directive,
		argValidators
	);

	removeDirectives(documentNode, directive);
	removeDefinitions(documentNode, 'DirectiveDefinition', directive);

	return {
		costMap,
		cleanSchema: print(documentNode),
	};
}

const isArrayOfStrings = (v) =>
	_.isArray(v) && !_.isEmpty(v) && _.every(v, _.isString);
const isArrayOfStringsOrNumbers = (v) =>
	_.isArray(v) && !_.isEmpty(v) && _.every(v, _.isString || _.isNumber);

module.exports = (typeDefs) => {
	const { costMap, cleanSchema } = extractDirectiveValues(typeDefs, 'cost', {
		complexity: _.isNumber,
		network: _.isNumber,
		db: _.isNumber,
		multipliers: isArrayOfStringsOrNumbers,
		useMultipliers: _.isBoolean,
		provides: isArrayOfStrings,
	});

	return {
		costMap,
		cleanSchema,
	};
};

module.exports.complexityTokens = complexityTokens;
