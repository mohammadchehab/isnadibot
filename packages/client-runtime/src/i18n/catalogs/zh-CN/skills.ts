export const skillsCatalog = {
  "Skill registry": "技能注册表",
  "Bots see a short index of skills, not the skills themselves. A skill's full instructions load only when a task needs it.":
    "机器人看到的是一份简短的技能索引，而不是技能本身。技能的完整说明只在任务需要时加载。",
  "Filter skills": "筛选技能",
  "This space": "此空间",
  "All skills": "所有技能",
  Unused: "未使用",
  "Add skill": "添加技能",
  Skill: "技能",
  "Used by": "使用者",
  Source: "来源",
  Size: "大小",
  "Last loaded": "上次加载",
  "Actions for {skill}": "{skill} 的操作",
  "Size is what loads when a skill is used. The index costs about 30 tokens per skill.":
    "大小是技能被使用时加载的内容。索引每项技能约花费 30 个词元。",
  "Remove from this space…": "从此空间移除…",
  "Remove from all spaces…": "从所有空间移除…",
  "The skill registry did not load.": "技能注册表未能加载。",
  "Try again in a moment.": "请稍后再试。",
  "Every skill has been used": "所有技能都已使用",
  "Skills appear here once a bot has loaded none of them.":
    "没有任何机器人加载过的技能会显示在这里。",
  "Skills a bot can load on demand show up here.": "机器人可按需加载的技能会显示在这里。",
  "Not indexed": "未建立索引",
  "Just now": "刚刚",
  "No role": "无角色",
  "All spaces": "所有空间",
  "Built in": "内置",
  Yours: "我的",
  Community: "社区",
  "Needs {connector}": "需要 {connector}",
  "A bot cannot use it until you approve it.": "在你批准之前，机器人无法使用它。",
  "Added from {origin} · a bot cannot use it until you approve it.":
    "添加自 {origin} · 在你批准之前，机器人无法使用它。",
  "Changed since you approved it.": "自你批准后已变更。",
  "{count} file added": "新增 {count} 个文件",
  "{count} edited": "修改 {count} 个",
  "{count} removed": "删除 {count} 个",
  "Changed at commit {commit} since you approved {approved} · {summary}.":
    "自你批准 {approved} 后，在提交 {commit} 处变更 · {summary}。",
  "Connect the {connector} connector in Settings › Connections. Until then a bot cannot run this skill.":
    "在 设置 › 连接 中连接 {connector} 连接器。在此之前机器人无法运行此技能。",
  "Add a skill": "添加技能",
  "A skill is a folder with a SKILL.md. Pick one to add to this space.":
    "技能是一个包含 SKILL.md 的文件夹。选择一个添加到当前空间。",
  "Paste a GitHub link to a skill folder. Isnadi pins the commit it reads.":
    "粘贴技能文件夹的 GitHub 链接。Isnadi 会固定它读取的提交。",
  "Upload a .zip of a skill folder. Isnadi checks it before adding anything.":
    "上传技能文件夹的 .zip。Isnadi 会先检查再添加任何内容。",
  "From a provider": "来自提供方",
  "GitHub URL": "GitHub 链接",
  ".zip": ".zip",
  "Where the skill comes from": "技能来源",
  "Add to": "添加到",
  "Travels with this space's project.": "随当前空间的项目一起移动。",
  "Every space you open on this computer.": "在这台电脑上打开的每个空间。",
  "{project}. The skill travels with this project.": "{project}。该技能随此项目一起移动。",
  "The provider keeps its copy. Isnadi adds its own, so every model keeps the skill.":
    "提供方保留自己的一份。Isnadi 添加自己的副本，因此每个模型都保留该技能。",
  "Skill URL": "技能链接",
  "No skill found at that link. Point at the folder that holds SKILL.md, not the repository root.":
    "该链接下未找到技能。请指向包含 SKILL.md 的文件夹，而不是仓库根目录。",
  "Isnadi reads the ref, resolves it to a commit and fetches only that folder.":
    "Isnadi 读取该引用，将其解析为提交，并只获取该文件夹。",
  "A community skill needs your approval before a bot can use it. The next step shows what it does.":
    "社区技能需要你批准后机器人才能使用。下一步会显示它的功能。",
  "Drop a .zip here": "将 .zip 拖放到这里",
  "Up to 5 MB and 200 files. No symlinks or executables.":
    "最大 5 MB、200 个文件。不得包含符号链接或可执行文件。",
  "That .zip is {size}": "该 .zip 为 {size}",
  "The limit is 5 MB. Remove the large files and try again.": "上限为 5 MB。请移除大文件后重试。",
  "That .zip has a link inside": "该 .zip 内含链接",
  "Archives may hold up to 200 plain files. Remove symlinks, absolute paths and executables, then try again.":
    "压缩包最多可包含 200 个普通文件。请移除符号链接、绝对路径和可执行文件后重试。",
  "Choose a file": "选择文件",
  "Choose a different file": "选择其他文件",
  "Check the link": "检查链接",
  "Add this skill?": "添加此技能？",
  "Read what it does before a bot can use it.": "在机器人使用它之前，先了解它的功能。",
  "Commit {commit} · {count} files · {size}": "提交 {commit} · {count} 个文件 · {size}",
  "What the bot will be told": "机器人将被告知的内容",
  "Approving pins this commit. If the folder changes, Isnadi asks again before a bot uses it.":
    "批准会固定此提交。如果文件夹发生变化，Isnadi 会在机器人使用前再次询问。",
} as const;
