> **中文译本**：本文件由英文原文翻译；命令、路径、配置键、代码块和链接目标保持原样，如译文与实现存在歧义，以英文原文和当前代码为准。

# 本地数据持久化

[手册](README.md) · [工作空间](workspaces.md) · [容器](CONTAINERIZATION.md)

DeepTutor 的默认安装不需要 PostgreSQL、MySQL 或其他数据库服务器。持久状态写在一个运行时主目录下，因此部署有一棵树可以挂载、检查和备份。某些状态存储在 SQLite 中，而设置、生成的工件、知识库索引、缓存和导入的源文件仍然是普通文件。

## 数据存在的地方

运行时主目录是您启动 DeepTutor 的目录。设置 `DEEPTUTOR_HOME` 或通过 `deeptutor start --home` / `deeptutor init --home` 选择其他目录。在已发布的容器中，同一棵树安装在 `/app/data` 处。

默认管理范围使用此布局：

| 小路 | 内容 |
| --- | --- |
| `data/user/settings/` | JSON/YAML 设置和提供商凭据 |
| `data/user/chat_history.db` | SQLite 会话、消息、回合、问题库条目和练习数据 |
| `data/user/.runtime/` | 私有运行时状态，例如“workspaces.sqlite3” |
| `data/user/workspace/` | 默认内容工作区和生成的工件 |
| `data/user/workspace/notebook/` | 最喜欢的集合及其索引为 JSON 文件（旧目录名称） |
| `data/user/workspace/co-writer/documents/doc_<id>/manifest.json` | 创作的注释页面、块、修订和页面元数据 |
| `data/user/logs/` | 应用程序日志 |
| `data/knowledge_bases/` | 知识库索引和版本化源数据 |
| `data/parse_cache/` | 共享文档解析缓存 |
| `data/users/<user-id>/` | 启用本地多用户身份验证时的每用户工作区根 |
| `data/partners/<partner-id>/` | 综合合作伙伴工作区 |
| `data/system/` | 账户、拨款、审计记录、索引和所有者凭证 |

选定的内容工作空间可以位于 `data/user` 之外。在这种情况下，其私有学习状态位于 `<workspace>/.deeptutor/data/` 下，而帐户设置、凭据、内存和工作区注册仍保留在运行时主目录中。运行 `deeptutor workspace show` 以打印选定的工作空间路径。

收藏夹和创作的笔记是单独的存储。旧版 `notebook_entries` SQLite 表保存题库条目；它不是用于存储创作的笔记块或喜爱的收藏。在选定的外部工作区中，这些基于文件的存储位于其私有 `.deeptutor/data/workspace/` 树下，使用相同的 `notebook/` 和 `co-writer/documents/` 子目录。备份整个工作区，包括隐藏的 `.deeptutor` 文件，以保留学习记录和笔记/喜爱的内容。

## 数据库支持

SQLite 是受支持的本地后端。没有支持的 PostgreSQL 或 MySQL 连接设置；设置 `DATABASE_URL` 或类似的环境变量不会重定向 DeepTutor 存储。

PocketBase 是通过 `data/user/settings/integrations.json` 配置的可选集成。它将支持的会话集合存储在 PocketBase 中，但它不是 PostgreSQL 适配器，并且不会将所有运行时状态移至 PocketBase。设置、凭据、知识库索引、解析缓存、日志和工作区工件保留在运行时树中。目前的PocketBase模式是单用户；对于支持的本地多用户 JSON/SQLite 布局，将 `integrations.pocketbase_url` 留空。

## 检查和备份状态

在 DeepTutor 创建数据后，在运行时主页中列出私有运行时树中的 SQLite 数据库：

```bash
find data -type f \( -name '*.db' -o -name '*.sqlite3' \) -print
```

对于选定的外部内容工作区，检查其私有数据库文件：

```bash
workspace="$(deeptutor workspace show | sed -n 's/^Path: //p')"
if [ -d "$workspace/.deeptutor/data" ]; then
  find "$workspace/.deeptutor/data" -type f \
    \( -name '*.db' -o -name '*.sqlite3' \) -print
fi
```

在复制 `data` 或工作区之前，停止 DeepTutor 和任何合作伙伴进程。 SQLite 可能具有实时预写日志文件，因此在应用程序运行时仅复制 `.db` 文件可能会丢失最近的事务。备份完整的运行时主目录 `data` 目录以及每个单独配置的内容工作区。将每个副本视为敏感副本，因为它可能包含凭据、私人对话文本和上传的学习材料。

## 实施与验证

- [deeptutor/runtime/home.py](../deeptutor/runtime/home.py)
- [deeptutor/services/path_service.py](../deeptutor/services/path_service.py)
- [deeptutor/services/workspace/context.py](../deeptutor/services/workspace/context.py)