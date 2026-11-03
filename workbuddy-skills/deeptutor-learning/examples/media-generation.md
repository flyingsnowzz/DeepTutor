# 场景 4：教学媒体生成

## 用户话术 A（可视化）
“帮我画一张学习闭环：练习→错题→复习→掌握。”
- `capabilities_list` 确认 visualize=ready
- `capability_run_submit{capability:"visualize", input:{prompt:"学习闭环流程图…"}, idempotency_key:"viz:loop:001"}`
- 轮询 → succeeded → `artifact_get{artifact_ref}` → 900 秒短期图片/文本链接

## 用户话术 B（音频导学）
“把勾股定理做成 3 分钟音频导学，我路上听。”
- 提交前提示：“大约 1–3 分钟，成功后计入媒体次数。”
- `audio_overview_generate_submit/get` → 音频 + 逐字稿 artifact

## 用户话术 C（视频课/数学动画）
- 先查 capabilities_list：
  - video_lesson ready → `lesson_video_generate_submit`（结构化课程通常约 30 秒–数分钟），完成后 artifact_get 取 `lesson.zip` 链接；提醒用户解压后用浏览器打开 `lesson.html`，这不是 MP4；
  - math_animator 若 missing_dependency（Manim/LaTeX/ffmpeg）→ 明确告知暂不可用，不承诺、不假装；
- math_animator 默认结构化场景模式的正确配置是 `input.config={"generation_mode":"storyboard"}`；返回 `render.generation_mode="storyboard"` 即表示命中结构化模式，不是回退失败。
- 链接 15 分钟过期，提醒及时打开；可 `capability_job_cancel` 取消。

## 成本/话术
- 只转述预计耗时与“成功后计量”，不报内部价格字段；
- 判分类结果注明“形成性反馈”。
