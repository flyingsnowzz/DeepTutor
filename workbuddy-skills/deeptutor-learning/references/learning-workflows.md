# 四类典型学习流程

## 1. K12 作业答疑（解题 + 同类练习）

1. 澄清：学段/学科；题目不完整时索要题干、图片或选项。
2. `problem_solve_submit`（input.prompt 含完整题目；带 idempotency_key）。
3. 轮询 `problem_solve_get`；把分步解答讲清楚，先思路后计算。
4. 需要巩固时 `quiz_generate_submit` 出 2 道同类题；完成后引导提交答案：
   - 若题目已在练习库：`practice_answer_check(entry_id, answer, request_id)`；
   - 讲解中强调方法与易错点，不直接替学生完成要上交的作业（可讲思路、让学生自己算）。
5. 话术示例见 `examples/solve-problem.md`。

## 2. 大学课程自学（资料精读 + 复习题）

1. 材料形态：文本直接传 content；PDF/课件先有 `artifact_ref`；视频字幕用 `kind=transcript`。
2. `reading_material_register` → `reading_session_start`。
3. 多轮 `reading_session_reply`：逐段总结（mode=summary）→ 针对段落提问 → mode=quiz 出复习题。
4. 回答必须呈现引用：`（第 N 页）`、`（章节：X）`、`（mm:ss）`。
5. 学完可 `hook_event_submit(material_finished)` 生成复习任务（若宿主无 Hook，则课后用 `review_tasks_list` 提醒）。
6. 示例见 `examples/reading-session.md`。

## 3. 练习闭环（答题 → 错因 → 掌握度变化）

1. 题目来源：出题作业写入、或 `practice_entry_create`（宿主/用户自有题）。
2. `practice_question_get` 展示题面 → 学生作答 → `practice_answer_check`（**每次新动作新 request_id**）。
3. 答错：
   - 工具返回 `review`（SM-2 调度与 due_at）与正确答案；讲错因、给一个最小例子；
   - 题目挂掌握路径时服务端自动写掌握证据事件；
4. 到期复习：`practice_queue_list` → `practice_review_submit(rating=again/hard/good/easy, request_id)`；
5. 阶段性总结：`practice_summary_get`（含错题/待复习数与额度），掌握度看 `mastery_map_get`。
6. 同一 request_id 重试返回首次结果，不重复计分。示例见 `examples/quiz-practice.md`。

## 4. 媒体讲解（可视化/音频/视频/动画）

1. 先 `capabilities_list`：
   - video/math 显示 `missing_dependency` 时明确告知服务端暂不可用，不要承诺；
2. 提交前一句话说明耗时与“成功后计量”（见 job-flow）。
3. submit → 轮询 → `artifact_get` 取短期链接（约 15 分钟有效），提醒及时打开/下载。
4. 音频导学适合通勤听；视频课/动画适合难概念；可视化适合结构与流程。
5. 示例见 `examples/media-generation.md`。

## 通用收尾：间隔复习

- 任务/课程结束后：宿主支持 Hook 时调 `hook_event_submit(job_completed/lesson_completed)`；
- 不支持时，告诉学生“明天可以问我『今天复习什么』”，届时调 `review_tasks_list` / `practice_queue_list`。
