#!/bin/bash
set -eo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
cd "$REPO_ROOT"

if ! [[ "$1" =~ ^[1-9][0-9]*$ ]]; then
  echo "Usage: $0 <iterations>  (positive integer)"
  exit 1
fi

# Unattended runs happen in a throwaway container that can only see the repo,
# so skipping permission prompts can't touch the rest of the host.
# One-time setup: ./ralph/setup.sh
require_image

RALPH_BRANCH=$(ralph_branch)
echo "Ralph working on branch $RALPH_BRANCH"

# node: stream assistant text and a one-line summary of each tool call as they arrive
stream_text_node='
process.stdin.setEncoding("utf8");
let b="";
process.stdin.on("data",c=>{
  b+=c;
  const ls=b.split("\n");
  b=ls.pop();
  for(const l of ls){
    if(!l.trim())continue;
    try{
      const o=JSON.parse(l);
      if(o.type==="assistant"&&o.message&&o.message.content)
        for(const c of o.message.content){
          if(c.type==="text"&&c.text)process.stdout.write(c.text+"\n");
          if(c.type==="tool_use"){
            const x=c.input||{};
            const arg=String(x.command||x.file_path||x.pattern||x.url||"").split("\n")[0].slice(0,120);
            process.stdout.write("  [tool] "+c.name+(arg?": "+arg:"")+"\n");
          }
        }
    }catch(e){}
  }
});
'

# node: print the final result text from the saved stream (stdin); exit 1 if the run errored
extract_result_node='
const lines=require("fs").readFileSync(0,"utf8").split("\n");
for(const l of lines){
  try{
    const o=JSON.parse(l);
    if(o.type==="result"){
      process.stdout.write(String(o.result??o.subtype??""));
      process.exit(o.is_error?1:0);
    }
  }catch(e){}
}
process.stdout.write("no result line in stream");
process.exit(1);
'

tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT

for ((i=1; i<=$1; i++)); do
  echo "=== Ralph iteration $i/$1 ==="

  commits=$(ralph_commits)
  issues=$(ralph_issue_index)
  prompt=$(cat ralph/prompt.md)

  run_in_container claude \
    --dangerously-skip-permissions \
    --max-turns 40 \
    --verbose \
    --print \
    --output-format stream-json \
    "<ralph_branch>$RALPH_BRANCH</ralph_branch>

<previous_ralph_commits>
${commits:-No RALPH commits yet}
</previous_ralph_commits>

<open_afk_issues>
$issues
</open_afk_issues>

$prompt" \
  | grep --line-buffered '^{' \
  | tee "$tmpfile" \
  | node -e "$stream_text_node" \
  || true  # a failed run is diagnosed from the saved stream below

  # Stop rather than burn iterations on rate limits / usage caps / API errors
  if ! result=$(node -e "$extract_result_node" < "$tmpfile"); then
    echo "Ralph iteration $i failed: $result"
    exit 1
  fi

  if [[ "$result" == *"<promise>NO MORE TASKS</promise>"* ]]; then
    echo "Ralph complete after $i iterations."
    exit 0
  fi
done

echo "Ralph hit the iteration cap ($1) with AFK tasks still open."
exit 1
