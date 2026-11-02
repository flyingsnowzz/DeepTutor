# 场景 3：练习闭环（答题 → 错因 → 掌握度）

## 用户话术
“我做完昨天那道选择题了，选 B。”

## 工具调用（示意）
1. `practice_queue_list` 或 `practice_entries_list{resolved:false}` 找到 entry_id（技能在会话内跟踪，不要求用户报 ID）
2. `practice_answer_check{entry_id, answer:"B", request_id:"<uuid-1>"}`
   - is_correct=false → 返回正确答案 + `review{rating,due_at,...}`；挂掌握路径时服务端写证据事件
3. 输出错因与最小例子；安排复习
4. 到期后 `practice_review_submit{entry_id, rating:"good", request_id:"<uuid-2>"}`
   → 新 due_at；同 request_id 重放返回 replayed:true，不重复计分
5. `practice_summary_get` 汇报：错题数、待复习、掌握度入口（mastery_map_get）

## 幂等要点
- 同一动作网络重试：复用 request_id；学生**再次作答新一题**：生成新 request_id。
- 不要让学生理解或输入 entry_id/request_id。
