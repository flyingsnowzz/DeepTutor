# 场景 2：大学 PDF 精读 + 复习题

## 用户话术
“这份《普通物理》讲义 PDF 帮我逐段读懂牛顿第二定律，读完出复习题。”

## 工具调用（示意）
1. 材料为已上传产物：`reading_material_register{kind:"pdf", title:"普通物理-力学", artifact_ref:"art_xxx"}`
   → `{material_id, segment_count, locator_types:["page"]}`
2. `reading_session_start{material_id, mode:"study"}` → session_id
3. `reading_session_reply{session_id, message:"先总结第 1–2 页", mode:"summary"}`
   → content + `citations:[{locator_type:"page", locator:"第 1 页", ...}]`
4. 学生追问“F=ma 中各量单位？”→ `reading_session_reply`（自动带章节引用）
5. `reading_session_reply{message:"出复习题", mode:"quiz"}` → 带引用的复习题
6. 学完：`hook_event_submit{event_type:"material_finished", idempotency_key:"workbuddy:material_finished:<uuid>", source_ref:material_id}`
   → 生成 1 个复习任务；宿主无 Hook 时课后改调 `review_tasks_list`

## 对用户的回复
保留“（第 N 页）”引用；无匹配时说“这几页没有直接讲到单位换算，建议参考附录”，不编造。
