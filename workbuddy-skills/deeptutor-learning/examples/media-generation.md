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
  - video_lesson ready → `lesson_video_generate_submit`（约 2–8 分钟），完成后 artifact_get 取 mp4 链接；
  - math_animator 若 missing_dependency（Manim/LaTeX/ffmpeg）→ 明确告知暂不可用，不承诺、不假装；
- 链接 15 分钟过期，提醒及时打开；可 `capability_job_cancel` 取消。

## 成本/话术
- 只转述预计耗时与“成功后计量”，不报内部价格字段；
- 判分类结果注明“形成性反馈”。
