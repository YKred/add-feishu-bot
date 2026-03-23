const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 【这里务必和你的实际路径一致！】
const CONFIG_PATH = '/root/.openclaw/openclaw.json';
const WORKSPACE_BASE = '/root/.openclaw/workspace/workspace';

// 中文常用词映射表，用于生成合法的 botId
const PINYIN_MAP = {
  '助':'zhu','理':'li','客':'ke','服':'fu','技':'ji','术':'shu',
  '运':'yun','营':'ying','代':'dai','码':'ma','写':'xie','作':'zuo',
  '文':'wen','档':'dang','管':'guan','理':'li','总':'zong','监':'jian',
  '经':'jing','销':'xiao','售':'shou','后':'hou','支':'zhi','持':'chi'
};

module.exports = async function(args) {
  // 1. 检查必填参数是否齐全
  const requiredFields = ['botName', 'appId', 'appSecret'];
  const missingFields = requiredFields.filter(field => !args[field]);
  if (missingFields.length > 0) {
    return `❌ 缺少必填信息：${missingFields.join('、')}\n\n请查看上方的使用指南，按要求提供完整信息。`;
  }

  // 2. 解构参数，补全默认值
  const { 
    botName, 
    appId, 
    appSecret, 
    model = "ark/doubao-seed-2.0-pro", 
    theme = "我是专业的机器人，为你提供专属服务。", 
    emoji = "🤖" 
  } = args;

  // ==========================================
  // 🐛 修复BUG1：botId生成逻辑，解决中文+数字生成非法ID的问题
  // ==========================================
  let botId = botName
    .toLowerCase()
    .replace(/[\u4e00-\u9fa5]/g, (ch) => PINYIN_MAP[ch] || '') // 中文转拼音
    .replace(/\s+/g, '-') // 空格转连字符
    .replace(/[^\w-]/g, '') // 移除非单词字符
    .replace(/-+/g, '-') // 合并多个连字符
    .replace(/^-|-$/g, ''); // 移除首尾连字符
  
  // 兜底：如果生成的ID是空/纯数字，自动加bot前缀
  if (!botId || /^\d+$/.test(botId)) {
    const timestamp = Date.now().toString().slice(-4);
    botId = `bot-${timestamp}`;
  }
  console.log(`🤖 最终生成合法机器人ID：${botId}`);

  try {
    // 3. 读取配置文件
    if (!fs.existsSync(CONFIG_PATH)) {
      throw new Error(`配置文件不存在：${CONFIG_PATH}`);
    }
    const configRaw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const config = JSON.parse(configRaw);

    // ==========================================
    // 🐛 修复BUG2：全链路容错，自动初始化不存在的配置节点
    // ==========================================
    config.agents = config.agents || {};
    config.agents.list = config.agents.list || [];
    config.channels = config.channels || {};
    config.channels.feishu = config.channels.feishu || { enabled: true };
    config.channels.feishu.accounts = config.channels.feishu.accounts || {}; // 核心修复点
    config.bindings = config.bindings || [];
    config.tools = config.tools || {};
    config.tools.agentToAgent = config.tools.agentToAgent || { enabled: true, allow: [] };
    config.tools.agentToAgent.allow = config.tools.agentToAgent.allow || [];

    // ==========================================
    // 🔒 【核心安全检查】只允许添加，绝不修改/删除已有配置
    // ==========================================
    
    // 检查1：Agent ID 是否已存在
    const existingAgent = config.agents.list.find(agent => agent.id === botId);
    if (existingAgent) {
      return `❌ 安全拦截：Agent ID【${botId}】已存在！\n\n为了保护已有配置，本工具只允许添加全新的机器人，不允许修改或覆盖已有的机器人。\n💡 请换一个机器人名字再试。`;
    }

    // 检查2：Account ID 是否已存在
    if (config.channels.feishu.accounts[botId]) {
      return `❌ 安全拦截：Account ID【${botId}】已存在！\n\n为了保护已有配置，本工具只允许添加全新的机器人，不允许修改或覆盖已有的机器人。\n💡 请换一个机器人名字再试。`;
    }

    // 检查3：工作区目录是否已存在
    const workspacePath = path.join(WORKSPACE_BASE, botId);
    if (fs.existsSync(workspacePath)) {
      return `❌ 安全拦截：工作区目录【${workspacePath}】已存在！\n\n为了保护已有数据，本工具不会覆盖已有的工作区目录。\n💡 请换一个机器人名字，或者手动删除已有的目录后再试。`;
    }

    console.log(`✅ 安全检查通过：Agent ID、Account ID、工作区目录均不存在，可以安全添加`);

    // ==========================================
    // 🔒 【安全检查通过】以下才是真正的修改操作
    // ==========================================

    // 4. 自动备份原配置文件（防翻车！）
    const backupPath = `${CONFIG_PATH}.backup.${Date.now()}`;
    fs.copyFileSync(CONFIG_PATH, backupPath);
    console.log(`💾 原配置已备份：${backupPath}`);

    // 5. 创建工作区目录
    fs.mkdirSync(workspacePath, { recursive: true });
    console.log(`📁 工作区目录已创建：${workspacePath}`);

    // 6. 修改配置文件（只做新增，不做任何修改/删除）
    // 6.1 新增Agent配置（只 push，不修改已有元素）
    const newAgent = {
      id: botId,
      name: botName,
      workspace: workspacePath,
      model: model,
      identity: { name: botName, theme: theme, emoji: emoji, avatar: "" }
    };
    config.agents.list.push(newAgent);
    console.log(`✅ Agent配置已添加（仅新增，未修改任何已有配置）`);

    // 6.2 新增飞书账号配置（只新增键，不修改已有键）
    config.channels.feishu.accounts[botId] = {
      appId: appId.trim(),
      appSecret: appSecret.trim(),
      streaming: true,
      footer: { elapsed: true, status: true }
    };
    console.log(`✅ 飞书账号配置已添加（仅新增，未修改任何已有配置）`);

    // 6.3 新增绑定规则（只 push，不修改已有元素）
    config.bindings.push({
      agentId: botId,
      match: { channel: "feishu", accountId: botId }
    });
    console.log(`✅ 消息绑定规则已添加（仅新增，未修改任何已有配置）`);

    // 6.4 新增到跨Agent调用白名单（只 push，不修改已有元素）
    if (!config.tools.agentToAgent.allow.includes(botId)) {
      config.tools.agentToAgent.allow.push(botId);
      console.log(`✅ 跨Agent调用白名单已更新（仅新增，未修改任何已有配置）`);
    }

    // 7. 保存新配置
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    console.log(`💾 新配置已保存`);

    // 8. 重启网关生效
    console.log(`🔄 正在重启OpenClaw网关...`);
    execSync('openclaw gateway restart', { stdio: 'ignore', timeout: 30000 });
    console.log(`✅ 网关重启成功`);

    // 9. 返回成功结果
    return `
🎉 恭喜！机器人【${botName}】创建成功！

🔒 安全确认：本次操作仅做了**新增**，未修改或删除任何已有配置

📋 最终配置信息
- 机器人ID：\`${botId}\`
- 绑定模型：\`${model}\`
- 工作区路径：\`${workspacePath}\`
- 原配置备份路径：\`${backupPath}\`

🚀 机器人已上线，现在可以去飞书找到它，发送消息测试啦！
    `;

  } catch (error) {
    console.error(`❌ 创建失败：${error.message}`);
    return `❌ 机器人创建失败，错误原因：${error.message}\n💡 请检查参数是否正确，或查看网关日志排查问题。`;
  }
};