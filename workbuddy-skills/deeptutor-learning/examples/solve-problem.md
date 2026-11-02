# 场景 1：K12 数学作业答疑

## 用户话术
“这道二次函数题不会：已知 y=x²-4x+3，求顶点坐标。一步步讲，再给我两道同类练习。”

## 命中技能
deeptutor-learning（意图：problem_solve + 出题）

## 工具调用（示意）
1. `capabilities_list` → problem_solve=ready
2. `problem_solve_submit`
   - input: `{"prompt":"已知二次函数 y=x²-4x+3，求顶点坐标。学段:初三","source_channel":"workbuddy"}`
   - idempotency_key: `solve:quadratic-vertex:001`
3. 轮询 `problem_solve_get`（1–2 秒起，退避）→ succeeded
4. `quiz_generate_submit`
   - input: `{"prompt":"出 2 道初三二次函数求顶点坐标的同类选择题"}`
   - key: `quiz:quadratic-vertex:001`
5. 轮询 `quiz_generate_job_get` → succeeded

## 对用户的最终回复（风格）
“先配方：y=(x-2)²-1，所以顶点是 (2,-1)。思路是把一般式变成顶点式，关键一步 x²-4x 要配成 (x-2)²-4。
给你两道同类题（略）……做完发给我，我帮你判并安排复习。”

## 备注
- 先讲思路再让学生自己算，不直接替交作业；
- 失败/超时时长与恢复：failed → 换 key 重试一次；CAPABILITY_UNAVAILABLE → 改文字讲解。
