> **中文译本**：本文件由英文原文翻译；命令、路径、配置键、代码块和链接目标保持原样，如译文与实现存在歧义，以英文原文和当前代码为准。

# 科学研究工作流程

[使用手册](README.md) · [相关指南](TOOLS_AND_CAPABILITIES.md)

DeepTutor 安装了 `preprint`、`research_audit` 和 `research_lit`，用于科学论文请求、支持论文搜索的聊天和深度研究。它们是上下文门控工具，与[工具和功能](TOOLS_AND_CAPABILITIES.md#mounting-rules)中描述的八个用户可切换工具分开。

- `preprint(paper, action="read", pages=[...])` 读取主 arXiv PDF，保留请求的版本和旧存档 ID，记录其 SHA-256 并返回页面级文本和原始源链接。下载上限为 32 MiB，PDF 上限为 500 页；通行证最多可读取 20 页/36,000 个字符。覆盖范围和缺失的可提取文本是明确的。
- `preprint(..., action="figures")` 选择标题候选页面，除非调用者命名页面。它呈现忠实的原始页面，而不是声称自动图形裁剪。最多有两个图像进入具有视觉功能的模型的请求本地模型上下文；像素永远不会进入持久的工具元数据。链接标识源版本和页面。渲染并不能证明模型确实检查了每张图像。
- `research_audit(paper, repository, ref="HEAD", files=[...], checks=[...])` 将 GitHub 修订解析为提交并读取最多 8 个静态文件。报价检查要求这些获取的来源中同时存在纸质和代码报价。数字差异是语义审查的候选者：参数映射、单位、默认值和活动路径仍然很重要。 Local/admin本机读取可以使用现有的`GITHUB_TOKEN`环境凭证；其他帐户使用自己授权的 MCP 连接，而不是借用部署令牌。公共 API 速率限制/访问失败仍然是未经验证的失败。该工作流程不执行下载的存储库代码或验证实验复制。使用方程式和方法的完整原始文本，并报告尚未验证的运行时/环境/数据检查。
- `research_lit(topic, followups=[...])` 搜索主要 arXiv 元数据，最多三个显式后续查询，并删除重复的纸张身份。它的矩阵记录了来源、作者、证据级别和覆盖范围。在分配同意/不同意之前阅读全文； Deep Research 的 APPEND 队列支持对矛盾和证据差距进行递归调查。

该报告将声明、方法、数据、指标、结果和限制与纸质页面和提交文件引用进行了比较。作者的发现、模型的推论、生成的摘要和社区注释仍然是不同的证据层。不可用的检索是失败，而不是空集或经过验证的发现。

## alphaXiv 和自托管研究 MCP

该目录包括带有 OAuth 的官方 [alphaXiv MCP 端点](https://www.alphaxiv.org/docs/mcp) 和四种研究阅读工具：发现、全文文本、页面查询和存储库文件。此预设不启用库写入工具。当需要主要证据时，请求`fullText=true`和`get_paper_content`；它默认生成分析中间报告。

聊天和深度研究对这些工具使用相同的帐户/工作空间/合作伙伴授权视图。  `preprint(action="mcp", mcp_tool="<qualified name>", arguments={...})` 可以调用广告的、授权的研究阅读操作。自托管 Feynman 风格的 MCP 服务器可以通过此绑定公开audit/lit/arxiv/alphaxiv 操作或只读讨论/注释操作。

`preprint(action="discussion")` 读取公共 alphaXiv 论文页面并标记注释覆盖范围未经验证：生成的概述和动态省略的注释不得作为主要论文或完整的讨论导出呈现。目前的官方 MCP 文档并未宣传专用的审核端点。如果配置的服务器公开 `get_comments`、 `get_discussions`、 `get_annotations` 或 `get_errata`，则该输出被显式标记为社区注释层；不可用的工具仍然不可用。

## 值得信赖的私人 MCP 起源

管理员可以通过在管理 MCP 注册表中设置 `allow_private_network=true` 来批准专用远程服务器源。编辑器公开了这个设置；禁用的管理条目可以用作批准，而不公布共享工具连接。仅当帐户自己的服务器的确切方案、主机和端口与当前管理员批准匹配时，才可以选择相同的标志。

```json
{
  "servers": {
    "research_origin_approval": {
      "url": "http://research.internal:8080/mcp",
      "allow_private_network": true,
      "enabled": false
    }
  }
}
```

该例外仅允许该源的 RFC1918 Docker/LAN 地址。自助环回、云元数据/链接本地地址和其他私有来源仍然被阻止。在连接/请求边界和工具准入时检查 DNS 和批准；撤销管理标志会阻止池连接的下一次调用。自助服务重定向仍处于禁用状态；在连接到目标之前检查共享传输重定向。此设置既不会更改 `web_fetch` 也不会更改本机纸张/存储库下载。旧版管理员拥有的本地/stdio 配置保留其原始行为。原生 arXiv 元数据在进程中调整；提供商速率限制错误仍然可见。请参阅 [arXiv API 文档](https://info.arxiv.org/help/api/user-manual.html)。

## 实施与验证

- [deeptutor/tools/research_tools.py](../deeptutor/tools/research_tools.py)
- [deeptutor/services/research/primitives.py](../deeptutor/services/research/primitives.py)
- [测试/服务/研究/test_primitives.py](../tests/services/research/test_primitives.py)
- [测试/服务/研究/test_mcp_boundaries.py](../tests/services/research/test_mcp_boundaries.py)