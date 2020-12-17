# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2020-12-17
### Added
- Graphql cost map extraction from schema. Also cleans up the schema of "cost" directive as apollo federation does not allow custom directives.
- Graphql query cost calculation using the cost map
- Example of usage with express + apollo-server

[Unreleased]: https://github.com/pipedrive/graphql-query-cost/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/pipedrive/graphql-query-cost/compare/v1.0.0...v1.0.0