#!/bin/bash
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <iterations>"
  exit 1
fi

# node: stream assistant text chunks to stdout as they arrive
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
        for(const c of o.message.content)
          if(c.type==="text"&&c.text)process.stdout.write(c.text);
    }catch(e){}
  }
});
'

for ((i=1; i<=$1; i++)); do
  tmpfile=$(node -p "require('path').join(require('os').tmpdir(),'ralph_'+Date.now()+'.json').replace(/\\\\/g,'/')")
  trap "rm -f '$tmpfile'" EXIT

  commits=$(git log -n 5 --format="%H%n%ad%n%B---" --date=short 2>/dev/null || echo "No commits found")
  issues=$(gh issue list --state open --json number,title,body,comments)
  prompt=$(cat ralph/prompt.md)

  claude \
    --verbose \
    --print \
    --output-format stream-json \
    --dangerously-skip-permissions \
    "Previous commits: $commits $issues $prompt" \
  | grep --line-buffered '^{' \
  | tee "$tmpfile" \
  | node -e "$stream_text_node"

  result=$(node -e "
const fs=require('fs');
const lines=fs.readFileSync('$tmpfile','utf8').split('\n');
for(const l of lines){
  try{
    const o=JSON.parse(l);
    if(o.type==='result'&&o.result!=null){process.stdout.write(o.result);break;}
  }catch(e){}
}
")

  if [[ "$result" == *"<promise>NO MORE TASKS</promise>"* ]]; then
    echo "Ralph complete after $i iterations."
    exit 0
  fi
done
