// Sub-Store sing-box 模板合并脚本
//
// 默认适配同目录 sing-box-momofake.json，并一次完成：
// 1. 读取订阅并填充分组
// 2. 创建落地节点的 -中转 副本
// 3. 过滤落地/中转节点
// 4. 区域无节点时安全回退到 🚀 默认代理
// 5. 节点 server 命中 local DNS 域名时指定 local resolver
// 6. 插入 hosts
// 7. 设置 Hysteria2 速率
//
// 默认参数均可在 Sub-Store 脚本参数中覆盖：
// name=自建机场
// type=远程订阅
// exclude=IX|ix|nlb|cf|CF|V6|出口|请勿
// excludeType=vless
// excludeRelay=
// excludeRelayType=vless
// hosts=op.refjttria.top@192.168.1.1,fn.refjttria.top@192.168.1.6
// hostsTag=hosts-local
// up=50
// down=500
//
// 可选参数：
// url=远程订阅 URL
// includeUnsupportedProxy=true
// outbound=沿用旧模板的 🕳分组🏷节点正则 格式；不传则使用本脚本内置规则

const DEFAULT_GROUP_TAG = '🚀 默认代理'
const LANDING_GROUP_TAG = '🚀 落地节点'
const RELAY_GROUP_TAG = '🧭 中转节点'
const COMPATIBLE_TAG = 'COMPATIBLE'
const RELAY_SUFFIX = '-中转'

const REGION_GROUP_TAGS = [
  '🇭🇰 香港手动',
  '🇹🇼 台湾手动',
  '🇯🇵 日本手动',
  '🇸🇬 狮城手动',
  '🇰🇷 韩国手动',
  '🇺🇲 美国手动',
  '🇩🇪 德国手动',
  '🇳🇱 荷兰手动',
]

const DEFAULT_RULE_SPECS = [
  ['^🧭 中转节点$', '.*'],
  ['^🇭🇰 香港手动$', 'ℹ️(?:香港|港|hong\\s*kong|(?:^|[^a-z])hk(?:[^a-z]|$)|🇭🇰)'],
  ['^🇹🇼 台湾手动$', 'ℹ️(?:台湾|臺灣|台灣|台|taiwan|(?:^|[^a-z])tw(?:[^a-z]|$)|🇹🇼)'],
  ['^🇯🇵 日本手动$', 'ℹ️(?:日本|日|japan|(?:^|[^a-z])jp(?:[^a-z]|$)|🇯🇵)'],
  ['^🇸🇬 狮城手动$', 'ℹ️(?:新加坡|狮城|獅城|坡|singapore|(?:^|[^a-z])sg(?:[^a-z]|$)|🇸🇬)'],
  ['^🇰🇷 韩国手动$', 'ℹ️(?:韩国|韓國|韩|韓|korea|(?:^|[^a-z])kr(?:[^a-z]|$)|🇰🇷)'],
  ['^🇺🇲 美国手动$', 'ℹ️(?:美国|美國|美|united\\s*states|(?:^|[^a-z])us(?:[^a-z]|$)|🇺🇸|🇺🇲)'],
  ['^🇩🇪 德国手动$', 'ℹ️(?:德国|德國|德|germany|(?:^|[^a-z])de(?:[^a-z]|$)|🇩🇪)'],
  ['^🇳🇱 荷兰手动$', 'ℹ️(?:荷兰|荷蘭|荷|netherlands|(?:^|[^a-z])nl(?:[^a-z]|$)|🇳🇱)'],
  ['^🐸 手动选择$', '.*'],
  ['^♻️ 自动选择$', '.*'],
  ['^🚀 落地节点$', '.*'],
]

const DEFAULTS = {
  name: '自建机场',
  type: 'subscription',
  exclude: 'IX|ix|nlb|cf|CF|V6|出口|请勿',
  excludeType: 'vless',
  excludeRelay: '',
  excludeRelayType: 'vless',
  hosts: 'op.refjttria.top@192.168.1.1,fn.refjttria.top@192.168.1.6',
  hostsTag: 'hosts-local',
  up: 50,
  down: 500,
}

log('🚀 开始')

const args = $arguments || {}
const parser = ProxyUtils.JSON5 || JSON
const config = parseConfig(parser)

const name = getArgument(args, 'name', DEFAULTS.name)
const type = normalizeSubscriptionType(getArgument(args, 'type', DEFAULTS.type))
const url = getArgument(args, 'url', '')
const includeUnsupportedProxy = args.includeUnsupportedProxy
const excludeRegex = createOptionalRegExp(getArgument(args, 'exclude', DEFAULTS.exclude), 'exclude')
const excludeTypeRegex = createOptionalRegExp(getArgument(args, 'excludeType', DEFAULTS.excludeType), 'excludeType')
const excludeRelayRegex = createOptionalRegExp(getArgument(args, 'excludeRelay', DEFAULTS.excludeRelay), 'excludeRelay')
const excludeRelayTypeRegex = createOptionalRegExp(
  getArgument(args, 'excludeRelayType', DEFAULTS.excludeRelayType),
  'excludeRelayType'
)
const hosts = getArgument(args, 'hosts', DEFAULTS.hosts)
const hostsTag = getArgument(args, 'hostsTag', DEFAULTS.hostsTag)
const upMbps = parseNonNegativeInteger(getArgument(args, 'up', DEFAULTS.up), 'up')
const downMbps = parseNonNegativeInteger(getArgument(args, 'down', DEFAULTS.down), 'down')

log(
  '参数 name=' + name +
  ', type=' + type +
  ', exclude=' + describeRegExp(excludeRegex) +
  ', excludeType=' + describeRegExp(excludeTypeRegex) +
  ', excludeRelay=' + describeRegExp(excludeRelayRegex) +
  ', excludeRelayType=' + describeRegExp(excludeRelayTypeRegex) +
  ', up=' + upMbps +
  ', down=' + downMbps
)

const artifact = await loadArtifact({
  name,
  type,
  url,
  includeUnsupportedProxy,
})

const sourceOutbounds = artifact.outbounds
const sourceEndpoints = artifact.endpoints
const sourceNodes = sourceOutbounds.concat(sourceEndpoints)

assertSourceTags(config, sourceNodes)

const outboundRules = args.outbound
  ? parseCustomOutboundRules(args.outbound)
  : createDefaultOutboundRules()

insertNodesIntoGroups(config, sourceNodes, outboundRules)
appendSourceDefinitions(config, sourceOutbounds, sourceEndpoints)
const localResolverCount = applyLocalServerResolvers(config, 'local')

const relayCloneCount = applyRelayRules(config, {
  excludeRegex,
  excludeTypeRegex,
  excludeRelayRegex,
  excludeRelayTypeRegex,
})

applyRegionFallback(config)
fillEmptyProxyGroups(config)
applyHosts(config, hosts, hostsTag)
const hysteria2Count = applyHysteria2Rates(config, upMbps, downMbps)

deduplicateGroupMembers(config)
validateConfig(config)

$content = JSON.stringify(config, null, 2)

log(
  '🔚 结束：订阅 outbounds=' + sourceOutbounds.length +
  ', endpoints=' + sourceEndpoints.length +
  ', 本地解析节点=' + localResolverCount +
  ', 中转副本=' + relayCloneCount +
  ', Hysteria2=' + hysteria2Count
)

function parseConfig(selectedParser) {
  const content = $content ?? ($files && $files[0])
  if (content == null) {
    throw new Error('未找到模板配置内容')
  }

  log('① 使用 ' + (ProxyUtils.JSON5 ? 'JSON5' : 'JSON') + ' 解析模板')

  let parsed
  try {
    parsed = selectedParser.parse(content)
  } catch (error) {
    log('模板解析失败：' + getErrorMessage(error))
    throw new Error('配置文件不是合法的 ' + (ProxyUtils.JSON5 ? 'JSON5' : 'JSON') + ' 格式')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('模板配置的根节点必须是对象')
  }
  if (!Array.isArray(parsed.outbounds)) {
    throw new Error('模板配置缺少 outbounds 数组')
  }

  return parsed
}

async function loadArtifact(options) {
  log('② 获取订阅')

  const produceOpts = {}
  if (options.includeUnsupportedProxy !== undefined) {
    produceOpts['include-unsupported-proxy'] = options.includeUnsupportedProxy
  }

  const request = {
    name: options.name,
    type: options.type,
    platform: 'sing-box',
    produceOpts,
  }

  if (options.url) {
    request.subscription = {
      name: options.name || 'remote',
      url: options.url,
      source: 'remote',
    }
    log('从 URL 读取订阅：' + options.url)
  } else {
    if (!options.name) {
      throw new Error('未传入订阅 name')
    }
    log('读取' + (options.type === 'collection' ? '组合' : '') + '订阅：' + options.name)
  }

  const result = await produceArtifact(request)
  let data
  try {
    data = typeof result === 'string' ? JSON.parse(result) : result
  } catch (error) {
    throw new Error('订阅产物不是合法的 sing-box JSON：' + getErrorMessage(error))
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('订阅产物格式错误：根节点必须是对象')
  }

  const outbounds = Array.isArray(data.outbounds) ? data.outbounds : []
  const endpoints = Array.isArray(data.endpoints) ? data.endpoints : []

  log('获取到 ' + outbounds.length + ' 个 outbounds，' + endpoints.length + ' 个 endpoints')
  return { outbounds, endpoints }
}

function assertSourceTags(targetConfig, sourceNodes) {
  const templateTags = collectDefinitionTags(targetConfig)
  const sourceTags = new Set()

  for (const node of sourceNodes) {
    if (!node || typeof node !== 'object' || typeof node.tag !== 'string' || !node.tag) {
      throw new Error('订阅中存在缺少 tag 的节点')
    }
    if (sourceTags.has(node.tag)) {
      throw new Error('订阅中存在重复节点 tag：' + node.tag)
    }
    if (templateTags.has(node.tag)) {
      throw new Error('订阅节点 tag 与模板冲突：' + node.tag)
    }
    sourceTags.add(node.tag)
  }
}

function createDefaultOutboundRules() {
  return DEFAULT_RULE_SPECS.map(function (spec) {
    return {
      outboundRegex: createRegExp(spec[0], '内置 outbound'),
      tagRegex: createRegExp(spec[1], '内置 tag'),
    }
  })
}

function parseCustomOutboundRules(value) {
  log('使用自定义 outbound 规则')

  return String(value)
    .split('🕳')
    .map(function (item) { return item.trim() })
    .filter(Boolean)
    .map(function (item) {
      const parts = item.split('🏷')
      const outboundPattern = parts[0]
      const tagPattern = parts[1] || '.*'
      return {
        outboundRegex: createRegExp(outboundPattern, 'outbound'),
        tagRegex: createRegExp(tagPattern, 'tag'),
      }
    })
}

function insertNodesIntoGroups(targetConfig, sourceNodes, rules) {
  log('③ 填充 outbound 分组')

  for (const rule of rules) {
    const tags = sourceNodes
      .filter(function (node) { return rule.tagRegex.test(node.tag) })
      .map(function (node) { return node.tag })

    let matchedGroupCount = 0

    for (const outbound of targetConfig.outbounds) {
      if (!outbound || typeof outbound.tag !== 'string') continue
      if (!rule.outboundRegex.test(outbound.tag)) continue

      matchedGroupCount++
      if (!Array.isArray(outbound.outbounds)) {
        outbound.outbounds = []
      }
      outbound.outbounds = unique(outbound.outbounds.concat(tags))
      log(
        '🕳 ' + outbound.tag +
        ' 匹配 ' + rule.outboundRegex +
        '，插入 ' + tags.length +
        ' 个匹配 ' + rule.tagRegex + ' 的节点'
      )
    }

    if (matchedGroupCount === 0) {
      log('⚠️ 模板中没有分组匹配：' + rule.outboundRegex)
    }
  }
}

function appendSourceDefinitions(targetConfig, sourceOutbounds, sourceEndpoints) {
  targetConfig.outbounds.push.apply(targetConfig.outbounds, sourceOutbounds)

  if (sourceEndpoints.length > 0) {
    if (!Array.isArray(targetConfig.endpoints)) {
      targetConfig.endpoints = []
    }
    targetConfig.endpoints.push.apply(targetConfig.endpoints, sourceEndpoints)
  }
}

function applyLocalServerResolvers(targetConfig, resolverTag) {
  log('④ 设置节点服务器域名解析')

  const rules = []
  const dnsRules = targetConfig.dns && Array.isArray(targetConfig.dns.rules)
    ? targetConfig.dns.rules
    : []

  for (const rule of dnsRules) {
    if (!toArray(rule.server).includes(resolverTag)) continue

    for (const domain of toArray(rule.domain)) {
      const value = normalizeDomain(domain)
      if (value) {
        rules.push({
          type: 'domain',
          value,
          disableCache: rule.disable_cache === true,
        })
      }
    }

    for (const suffix of toArray(rule.domain_suffix)) {
      const value = normalizeDomain(suffix).replace(/^\.+/, '')
      if (value) {
        rules.push({
          type: 'domain_suffix',
          value,
          disableCache: rule.disable_cache === true,
        })
      }
    }
  }

  let count = 0
  for (const definition of getDefinitions(targetConfig)) {
    if (!definition || typeof definition.server !== 'string') continue

    const server = normalizeDomain(definition.server)
    const matchedRule = rules.find(function (rule) {
      return rule.type === 'domain'
        ? server === rule.value
        : server === rule.value || server.endsWith('.' + rule.value)
    })
    if (!matchedRule) continue

    definition.domain_resolver = {
      server: resolverTag,
      disable_cache: matchedRule.disableCache,
    }
    count++
    log(
      '🏠 ' + definition.tag +
      ' 的 server=' + definition.server +
      ' 使用 ' + resolverTag +
      ' 解析，disable_cache=' + matchedRule.disableCache
    )
  }

  return count
}

function applyRelayRules(targetConfig, options) {
  log('⑤ 创建落地中转副本')

  const landingGroup = findOutbound(targetConfig, LANDING_GROUP_TAG)
  const relayGroup = findOutbound(targetConfig, RELAY_GROUP_TAG)

  if (!landingGroup || !Array.isArray(landingGroup.outbounds)) {
    throw new Error('模板缺少 ' + LANDING_GROUP_TAG + ' selector')
  }
  if (!relayGroup || !Array.isArray(relayGroup.outbounds)) {
    throw new Error('模板缺少 ' + RELAY_GROUP_TAG + ' selector')
  }

  const endpointTags = new Set(
    (Array.isArray(targetConfig.endpoints) ? targetConfig.endpoints : [])
      .map(function (item) { return item.tag })
      .filter(Boolean)
  )
  const byTag = buildDefinitionMap(targetConfig)
  const newLandingTags = []
  let cloneCount = 0

  for (const tag of landingGroup.outbounds) {
    const exactDefinition = byTag.get(tag)
    const baseTag = (
      exactDefinition &&
      exactDefinition.detour === RELAY_GROUP_TAG &&
      tag.endsWith(RELAY_SUFFIX)
    )
      ? stripRelaySuffix(tag)
      : tag
    const original = byTag.get(baseTag)

    if (!original) {
      log('⚠️ 落地组引用未找到定义，跳过：' + tag)
      continue
    }
    if (endpointTags.has(baseTag)) {
      log('⚠️ endpoint 不创建 detour 副本，跳过：' + baseTag)
      continue
    }
    if (options.excludeRegex && options.excludeRegex.test(baseTag)) {
      log('⛔ 落地排除(tag)：' + baseTag)
      continue
    }
    if (options.excludeTypeRegex && options.excludeTypeRegex.test(String(original.type || ''))) {
      log('⛔ 落地排除(type)：' + baseTag + '，type=' + original.type)
      continue
    }

    const clonedTag = baseTag + RELAY_SUFFIX
    const existingClone = byTag.get(clonedTag)
    if (existingClone && existingClone.detour !== RELAY_GROUP_TAG) {
      throw new Error('中转副本 tag 与现有节点冲突：' + clonedTag)
    }
    if (!existingClone) {
      const cloned = deepClone(original)
      cloned.tag = clonedTag
      cloned.detour = RELAY_GROUP_TAG
      targetConfig.outbounds.push(cloned)
      byTag.set(clonedTag, cloned)
      cloneCount++
      log('✅ 落地拷贝：' + baseTag + ' -> ' + clonedTag + '，detour=' + RELAY_GROUP_TAG)
    }
    newLandingTags.push(clonedTag)
  }

  landingGroup.outbounds = unique(newLandingTags)

  if (options.excludeRelayRegex || options.excludeRelayTypeRegex) {
    const before = relayGroup.outbounds.length
    relayGroup.outbounds = unique(relayGroup.outbounds).filter(function (tag) {
      if (options.excludeRelayRegex && options.excludeRelayRegex.test(tag)) {
        log('⛔ 中转排除(tag)：' + tag)
        return false
      }
      if (
        options.excludeRelayTypeRegex &&
        hasExcludedType(tag, byTag, options.excludeRelayTypeRegex, new Set())
      ) {
        log('⛔ 中转排除(type)：' + tag)
        return false
      }
      return true
    })
    log('🧹 中转组过滤：' + before + ' -> ' + relayGroup.outbounds.length)
  }

  return cloneCount
}

function applyRegionFallback(targetConfig) {
  log('⑥ 处理区域空分组')

  const defaultGroup = findOutbound(targetConfig, DEFAULT_GROUP_TAG)
  if (!defaultGroup || !Array.isArray(defaultGroup.outbounds)) {
    throw new Error('模板缺少 ' + DEFAULT_GROUP_TAG + ' selector')
  }

  for (const regionTag of REGION_GROUP_TAGS) {
    const regionGroup = findOutbound(targetConfig, regionTag)
    if (!regionGroup || !Array.isArray(regionGroup.outbounds)) {
      throw new Error('模板缺少区域 selector：' + regionTag)
    }

    const actualMembers = unique(regionGroup.outbounds).filter(function (tag) {
      return tag !== DEFAULT_GROUP_TAG && tag !== COMPATIBLE_TAG
    })

    if (actualMembers.length > 0) {
      regionGroup.outbounds = actualMembers
      continue
    }

    // 避免 区域 -> 默认 -> 区域 形成选择器循环。
    defaultGroup.outbounds = defaultGroup.outbounds.filter(function (tag) {
      return tag !== regionTag
    })
    regionGroup.outbounds = [DEFAULT_GROUP_TAG]
    log('↪️ ' + regionTag + ' 无节点，回退到 ' + DEFAULT_GROUP_TAG + '，并从默认组移除该区域引用')
  }

  defaultGroup.outbounds = unique(defaultGroup.outbounds)
}

function fillEmptyProxyGroups(targetConfig) {
  const emptyGroups = targetConfig.outbounds.filter(function (outbound) {
    return (
      outbound &&
      (outbound.type === 'selector' || outbound.type === 'urltest') &&
      (!Array.isArray(outbound.outbounds) || outbound.outbounds.length === 0)
    )
  })

  if (emptyGroups.length === 0) return

  let compatible = findOutbound(targetConfig, COMPATIBLE_TAG)
  if (!compatible) {
    compatible = {
      tag: COMPATIBLE_TAG,
      type: 'direct',
    }
    targetConfig.outbounds.push(compatible)
  } else if (compatible.type !== 'direct') {
    throw new Error(COMPATIBLE_TAG + ' 已存在但不是 direct outbound')
  }

  for (const group of emptyGroups) {
    group.outbounds = [COMPATIBLE_TAG]
    log('↪️ ' + group.tag + ' 为空，插入 ' + COMPATIBLE_TAG + '(direct)')
  }
}

function applyHosts(targetConfig, hostsSpec, hostsServerTag) {
  log('⑦ 插入 hosts')

  const hostsMap = parseHosts(hostsSpec)
  const domains = Object.keys(hostsMap)
  if (domains.length === 0) {
    log('未提供有效 hosts，跳过')
    return
  }

  if (!targetConfig.dns || typeof targetConfig.dns !== 'object') {
    targetConfig.dns = {}
  }
  if (!Array.isArray(targetConfig.dns.servers)) {
    targetConfig.dns.servers = []
  }
  if (!Array.isArray(targetConfig.dns.rules)) {
    targetConfig.dns.rules = []
  }

  let hostsServer = targetConfig.dns.servers.find(function (server) {
    return server.tag === hostsServerTag
  })

  if (!hostsServer) {
    hostsServer = {
      tag: hostsServerTag,
      type: 'hosts',
      predefined: {},
    }
    targetConfig.dns.servers.unshift(hostsServer)
    log('新增 DNS hosts server：' + hostsServerTag)
  } else if (hostsServer.type !== 'hosts') {
    throw new Error('DNS server ' + hostsServerTag + ' 已存在但 type 不是 hosts')
  }

  if (!hostsServer.predefined || typeof hostsServer.predefined !== 'object') {
    hostsServer.predefined = {}
  }
  Object.assign(hostsServer.predefined, hostsMap)

  let hostsRule = targetConfig.dns.rules.find(function (rule) {
    return rule.server === hostsServerTag
  })

  if (!hostsRule) {
    hostsRule = {
      domain: domains.slice(),
      server: hostsServerTag,
    }

    const rejectIndex = targetConfig.dns.rules.findIndex(isHttpsRejectRule)
    if (rejectIndex >= 0) {
      targetConfig.dns.rules.splice(rejectIndex + 1, 0, hostsRule)
      log('hosts 规则插入到 HTTPS reject 之后')
    } else {
      targetConfig.dns.rules.unshift(hostsRule)
      log('未找到 HTTPS reject，hosts 规则插入到最前')
    }
  } else {
    const currentDomains = Array.isArray(hostsRule.domain)
      ? hostsRule.domain
      : hostsRule.domain
        ? [hostsRule.domain]
        : []
    hostsRule.domain = unique(currentDomains.concat(domains))
    log('合并已有 hosts 规则')
  }
}

function applyHysteria2Rates(targetConfig, up, down) {
  log('⑧ 设置 Hysteria2 速率')

  let count = 0
  for (const outbound of targetConfig.outbounds) {
    if (outbound && outbound.type === 'hysteria2') {
      outbound.up_mbps = up
      outbound.down_mbps = down
      count++
      log('⚡ ' + outbound.tag + '：⬆️ ' + up + ' Mbps，⬇️ ' + down + ' Mbps')
    }
  }
  return count
}

function validateConfig(targetConfig) {
  log('⑨ 校验生成配置')

  const definitions = getDefinitions(targetConfig)
  const allTags = new Set()

  for (const item of definitions) {
    if (!item || typeof item.tag !== 'string' || !item.tag) {
      throw new Error('生成配置中存在缺少 tag 的 outbound/endpoint')
    }
    if (allTags.has(item.tag)) {
      throw new Error('生成配置中存在重复 tag：' + item.tag)
    }
    allTags.add(item.tag)
  }

  for (const outbound of targetConfig.outbounds) {
    if (outbound.type === 'selector' || outbound.type === 'urltest') {
      if (!Array.isArray(outbound.outbounds) || outbound.outbounds.length === 0) {
        throw new Error('分组 outbounds 为空：' + outbound.tag)
      }
      assertKnownTags(outbound.outbounds, allTags, '分组 ' + outbound.tag)
    }
    if (outbound.detour) {
      assertKnownTags([outbound.detour], allTags, 'detour ' + outbound.tag)
    }
  }

  const inboundTags = new Set(
    (Array.isArray(targetConfig.inbounds) ? targetConfig.inbounds : [])
      .map(function (item) { return item.tag })
      .filter(Boolean)
  )
  const dnsTags = new Set(
    targetConfig.dns && Array.isArray(targetConfig.dns.servers)
      ? targetConfig.dns.servers.map(function (item) { return item.tag }).filter(Boolean)
      : []
  )

  const ruleSetTags = new Set(
    targetConfig.route && Array.isArray(targetConfig.route.rule_set)
      ? targetConfig.route.rule_set.map(function (item) { return item.tag }).filter(Boolean)
      : []
  )

  if (targetConfig.route) {
    if (targetConfig.route.final) {
      assertKnownTags([targetConfig.route.final], allTags, 'route.final')
    }

    for (const rule of arrayOrEmpty(targetConfig.route.rules)) {
      assertKnownTags(toArray(rule.outbound), allTags, 'route rule outbound')
      assertKnownTags(toArray(rule.inbound), inboundTags, 'route rule inbound')
      assertKnownTags(toArray(rule.rule_set), ruleSetTags, 'route rule_set')
    }

    for (const ruleSet of arrayOrEmpty(targetConfig.route.rule_set)) {
      if (ruleSet.download_detour) {
        assertKnownTags([ruleSet.download_detour], allTags, 'rule_set download_detour ' + ruleSet.tag)
      }
    }
  }

  if (targetConfig.dns) {
    for (const server of arrayOrEmpty(targetConfig.dns.servers)) {
      if (server.detour) {
        assertKnownTags([server.detour], allTags, 'DNS detour ' + server.tag)
      }
      if (server.domain_resolver) {
        const resolverTag = typeof server.domain_resolver === 'string'
          ? server.domain_resolver
          : server.domain_resolver.server
        assertKnownTags(toArray(resolverTag), dnsTags, 'DNS domain_resolver ' + server.tag)
      }
    }

    for (const rule of arrayOrEmpty(targetConfig.dns.rules)) {
      assertKnownTags(toArray(rule.server), dnsTags, 'DNS rule server')
      assertKnownTags(toArray(rule.inbound), inboundTags, 'DNS rule inbound')
      assertKnownTags(toArray(rule.rule_set), ruleSetTags, 'DNS rule_set')
    }
  }

  assertNoSelectorCycles(targetConfig.outbounds)
  log('配置校验通过：无重复 tag、空分组、缺失引用或选择器循环')
}

function assertNoSelectorCycles(outbounds) {
  const graph = new Map()

  for (const outbound of outbounds) {
    if (
      outbound &&
      typeof outbound.tag === 'string' &&
      (outbound.type === 'selector' || outbound.type === 'urltest')
    ) {
      graph.set(outbound.tag, [])
    }
  }

  for (const outbound of outbounds) {
    if (!graph.has(outbound.tag)) continue
    graph.set(
      outbound.tag,
      outbound.outbounds.filter(function (tag) { return graph.has(tag) })
    )
  }

  const state = new Map()
  const stack = []

  function visit(tag) {
    const currentState = state.get(tag) || 0
    if (currentState === 2) return
    if (currentState === 1) {
      const start = stack.indexOf(tag)
      const cycle = stack.slice(start).concat(tag)
      throw new Error('检测到选择器循环：' + cycle.join(' -> '))
    }

    state.set(tag, 1)
    stack.push(tag)
    for (const child of graph.get(tag) || []) {
      visit(child)
    }
    stack.pop()
    state.set(tag, 2)
  }

  for (const tag of graph.keys()) {
    visit(tag)
  }
}

function deduplicateGroupMembers(targetConfig) {
  for (const outbound of targetConfig.outbounds) {
    if (Array.isArray(outbound.outbounds)) {
      outbound.outbounds = unique(outbound.outbounds)
    }
  }
}

function parseHosts(value) {
  const result = {}
  if (!value) return result

  for (const rawItem of String(value).split(',')) {
    const item = rawItem.trim().replace(/\\@/g, '@')
    const separatorIndex = item.lastIndexOf('@')
    if (separatorIndex <= 0 || separatorIndex === item.length - 1) {
      if (item) log('⚠️ 无效 hosts 项，跳过：' + item)
      continue
    }

    const domain = item.slice(0, separatorIndex).trim()
    const address = item.slice(separatorIndex + 1).trim()
    if (domain && address) {
      result[domain] = address
    }
  }

  return result
}

function isHttpsRejectRule(rule) {
  if (!rule || rule.action !== 'reject') return false
  return toArray(rule.query_type).some(function (type) {
    return String(type).toUpperCase() === 'HTTPS'
  })
}

function hasExcludedType(tag, byTag, typeRegex, visited) {
  if (visited.has(tag)) return false
  visited.add(tag)

  const node = byTag.get(tag)
  if (!node) return false
  if (typeRegex.test(String(node.type || ''))) return true

  if (Array.isArray(node.outbounds)) {
    return node.outbounds.some(function (childTag) {
      return hasExcludedType(childTag, byTag, typeRegex, visited)
    })
  }

  return false
}

function assertKnownTags(tags, knownTags, context) {
  for (const tag of tags.filter(Boolean)) {
    if (!knownTags.has(tag)) {
      throw new Error(context + ' 引用了不存在的 tag：' + tag)
    }
  }
}

function collectDefinitionTags(targetConfig) {
  return new Set(
    getDefinitions(targetConfig)
      .map(function (item) { return item && item.tag })
      .filter(Boolean)
  )
}

function buildDefinitionMap(targetConfig) {
  return new Map(
    getDefinitions(targetConfig)
      .filter(function (item) { return item && item.tag })
      .map(function (item) { return [item.tag, item] })
  )
}

function getDefinitions(targetConfig) {
  const outbounds = Array.isArray(targetConfig.outbounds) ? targetConfig.outbounds : []
  const endpoints = Array.isArray(targetConfig.endpoints) ? targetConfig.endpoints : []
  return outbounds.concat(endpoints)
}

function findOutbound(targetConfig, tag) {
  return targetConfig.outbounds.find(function (outbound) {
    return outbound && outbound.tag === tag
  })
}

function stripRelaySuffix(tag) {
  return tag.endsWith(RELAY_SUFFIX)
    ? tag.slice(0, -RELAY_SUFFIX.length)
    : tag
}

function normalizeDomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '')
}

function normalizeSubscriptionType(value) {
  return /^1$|col|组合/i.test(String(value || ''))
    ? 'collection'
    : 'subscription'
}

function createOptionalRegExp(value, label) {
  return value ? createRegExp(value, label) : null
}

function createRegExp(value, label) {
  const pattern = String(value == null ? '' : value)
  const ignoreCase = pattern.includes('ℹ️')
  const source = pattern.split('ℹ️').join('')
  try {
    return new RegExp(source, ignoreCase ? 'i' : undefined)
  } catch (error) {
    throw new Error(label + ' 正则无效：' + source + '；' + getErrorMessage(error))
  }
}

function parseNonNegativeInteger(value, name) {
  const number = Number.parseInt(value, 10)
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(name + ' 必须是非负整数')
  }
  return number
}

function getArgument(object, name, fallback) {
  return object[name] === undefined ? fallback : object[name]
}

function describeRegExp(regex) {
  return regex ? String(regex) : '(无)'
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : []
}

function toArray(value) {
  if (value == null || value === '') return []
  return Array.isArray(value) ? value : [value]
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)))
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function getErrorMessage(error) {
  return error && error.message ? error.message : String(error)
}

function log(value) {
  console.log('[📦 sing-box 合并脚本] ' + value)
}
