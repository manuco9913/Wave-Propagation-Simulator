set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <iterations>"
  exit 1
fi

for ((i=1; i<=$1; i++)); do
  echo "Iteration $i"
  echo "--------------------------------"

  pending=$(node -e "const f=require('./plans/prd.json');console.log(JSON.stringify(f.filter(x=>!x.passes)))")
  recent=$(tail -n 50 progress.txt 2>/dev/null || echo "")

  # Step 1: cheap planning call — pick the next feature
  feature=$(claude --permission-mode acceptEdits -p \
    "PENDING PRD FEATURES (JSON): $pending

Pick the single highest-priority feature to implement next. Return ONLY the raw JSON object for that one feature, no commentary.")
  # Strip markdown code fences if the model wrapped the response
  feature=$(echo "$feature" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const m=s.match(/\{[\s\S]*\}/);console.log(m?m[0].trim():s.trim())})")

  echo "Selected feature: $feature"
  echo "--------------------------------"

  # Step 2: implement only that one feature
  result=$(claude --permission-mode acceptEdits -p \
    "FEATURE TO IMPLEMENT (JSON):
$feature

RECENT PROGRESS:
$recent

1. Implement this feature using the /tdd skill.
2. Check that types check via npm run typecheck and that the tests pass via npm run test.
   If the feature is UI-facing and unit tests are insufficient to verify it, use the Playwright MCP browser tools to test it at http://localhost:5173 — otherwise skip it.
3. Update plans/prd.json: set passes:true for the completed feature.
4. Append your progress to progress.txt. Be extremely concise, sacrifice grammar if needed.
5. Make a git commit of that feature.
ONLY WORK ON THIS SINGLE FEATURE.
If, while implementing the feature, you notice the PRD is complete, output <promise>COMPLETE</promise>.")

  echo "$result"

  if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
    echo "PRD complete, exiting."
    exit 0
  fi
done
