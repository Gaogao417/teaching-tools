request = Import[$ScriptCommandLine[[2]], "RawJSON"];
checks = Lookup[request, "checks", {}];

results = Map[
  Function[check,
    Module[{passed},
      passed = Quiet[Check[TrueQ[ToExpression[Lookup[check, "expression", "False"]]], False]];
      <|
        "name" -> Lookup[check, "name", "wolfram-check"],
        "passed" -> passed,
        "message" -> If[passed, "Wolfram expression evaluated to True.", "Wolfram expression did not evaluate to True."]
      |>
    ]
  ],
  checks
];

Export[
  $ScriptCommandLine[[3]],
  <|
    "passed" -> And @@ Lookup[results, "passed", False],
    "summary" -> StringJoin[ToString[Count[Lookup[results, "passed", False], True]], "/", ToString[Length[results]], " Wolfram checks passed"],
    "checks" -> results
  |>,
  "RawJSON"
];
