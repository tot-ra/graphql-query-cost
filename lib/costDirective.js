module.exports = `directive @cost(
  complexity: Int
  network: Int
  db: Int
  multipliers: [String]
  useMultipliers: Boolean
  provides: [String]
) on FIELD | FIELD_DEFINITION
`;
