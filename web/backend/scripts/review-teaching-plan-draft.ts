import { readFileSync } from "node:fs";
async function main() {
 process.env.SQLITE_PATH=":memory:";
 const {reviewPlanDraft}=await import("../src/services/planBuild/authoring/ReviewPlanDraft");
 const args=process.argv.slice(2);const value=(k:string)=>{const i=args.indexOf(k);if(i<0||!args[i+1])throw new Error(k+" required");return args[i+1]};
 const result=reviewPlanDraft(value("--canonical-root"),JSON.parse(readFileSync(value("--candidate"),"utf8")),args.includes("--catalog")?JSON.parse(readFileSync(value("--catalog"),"utf8")):undefined);
 console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;
}
main().catch(e=>{console.error(String(e));process.exitCode=1});
