# S3 Dependency Contract
S4 must descend from `cd6c780e795b86f6f198f7e1697236de0008c3b7`.
Verify all S0/S1/S2/S3 tests pass, PBTrainingAnalytics is read-only, PBStore DB_VERSION is 2,
and canonical counts remain 13/35.
Consume S3 output; do not duplicate S3 aggregation logic.
