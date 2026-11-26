// Original developer vocabulary and example sentences. Available entirely offline.
const entries = [
  ['idempotent', '/ˌaɪdəmˈpoʊtənt/', '幂等的；重复执行仍得到相同结果', 'Producing the same result when repeated.', 'Make the retry handler idempotent.', '让重试处理器保持幂等。', 'An idempotent request can safely be sent twice.', '幂等请求可以安全地发送两次。'],
  ['regression', '/rɪˈɡreʃən/', '回归问题；改动使已正常工作的功能失效', 'A change that breaks previously working behavior.', 'Add a test to catch this regression.', '添加一个测试来捕获这个回归问题。', 'The release introduced a regression in keyboard navigation.', '这个版本在键盘导航上引入了回归问题。'],
  ['fallback', '/ˈfɔːlbæk/', '备用方案；主路径失败时使用的逻辑', 'An alternative used when the main approach fails.', 'Use the cached response as a fallback.', '使用缓存响应作为备用方案。', 'The app provides an offline fallback when the network is unavailable.', '网络不可用时，应用会提供离线备用方案。'],
  ['constraint', '/kənˈstreɪnt/', '约束；必须满足的条件', 'A limit or condition that must be satisfied.', 'Clarify the latency constraint in the prompt.', '在提示词中明确延迟约束。', 'Memory is the main constraint on this device.', '内存是这台设备的主要限制。'],
  ['grounding', '/ˈɡraʊndɪŋ/', '使输出以给定证据或来源为依据', 'Connecting an answer to reliable evidence or context.', 'Grounding ties the answer to the retrieved documents.', '依据关联让回答与检索到的文档相联系。', 'Better grounding makes unsupported claims easier to detect.', '更充分的证据关联让无依据的说法更容易被发现。'],
  ['provenance', '/ˈprɑːvənəns/', '来源及演变记录', 'The origin and history of something.', 'Record the provenance of each retrieved fact.', '记录每条检索事实的来源。', 'The dataset includes provenance for every image.', '这个数据集记录了每张图片的来源。'],
  ['latency', '/ˈleɪtənsi/', '延迟；从请求到响应之间的时间', 'The delay between an action and its response.', 'Stream tokens to reduce perceived latency.', '流式输出词元以降低感知延迟。', 'We measure latency at the edge of the service.', '我们在服务边界测量延迟。'],
  ['deterministic', '/dɪˌtɜːrmɪˈnɪstɪk/', '确定性的；相同输入产生相同输出', 'Producing predictable results from the same inputs.', 'Keep the acceptance test deterministic.', '让验收测试保持确定性。', 'A fixed seed makes this simulation deterministic.', '固定种子让这次模拟具有确定性。'],
  ['inference', '/ˈɪnfərəns/', '推理；用训练好的模型计算输出', 'Drawing a conclusion; running a trained model to produce outputs.', 'Run inference locally to keep the data private.', '在本机运行推理以保护数据隐私。', 'Batching requests improves inference throughput.', '对请求进行批处理可以提高推理吞吐量。'],
  ['throughput', '/ˈθruːpʊt/', '吞吐量；单位时间处理的工作量', 'The amount of work processed in a given time.', 'The new queue doubles the service throughput.', '新的队列使服务吞吐量翻倍。', 'Higher throughput does not always mean lower latency.', '更高的吞吐量并不总意味着更低的延迟。'],
  ['orchestration', '/ˌɔːrkɪˈstreɪʃən/', '编排；协调多个组件完成任务', 'Coordinating multiple components to complete a task.', 'The orchestration layer assigns work to each agent.', '编排层为各个智能体分配工作。', 'Keep orchestration separate from business rules.', '将编排与业务规则分开。'],
  ['retrieval', '/rɪˈtriːvəl/', '检索；查找并获取相关信息', 'Finding and obtaining relevant information.', 'Retrieval selects the documents before generation begins.', '检索在生成开始之前选择文档。', 'We evaluate retrieval quality with a labeled dataset.', '我们用标注数据集评估检索质量。'],
  ['embedding', '/ɪmˈbedɪŋ/', '嵌入；将内容表示为向量', 'A vector representation of content.', 'Store an embedding for each document chunk.', '为每个文档片段存储一个嵌入向量。', 'Similar sentences often have nearby embeddings.', '相似句子的嵌入向量通常彼此接近。'],
  ['checkpoint', '/ˈtʃekpɔɪnt/', '检查点；可恢复的中间状态', 'A saved state from which work can resume.', 'Save a checkpoint before the long-running task.', '在长时间运行的任务之前保存检查点。', 'Training resumed from the latest checkpoint.', '训练从最新检查点恢复。'],
  ['observability', '/əbˌzɜːrvəˈbɪləti/', '可观测性；通过输出理解系统内部状态的能力', 'The ability to understand a system through its outputs.', 'Traces improve observability across service boundaries.', '链路追踪提高了跨服务的可观测性。', 'Good observability shortens incident investigations.', '良好的可观测性可以缩短故障调查时间。'],
  ['reproducible', '/ˌriːprəˈduːsəbəl/', '可复现的', 'Able to be repeated with consistent results.', 'Include the environment details to make the bug reproducible.', '附上环境信息，让这个问题可以复现。', 'A lockfile helps create reproducible builds.', '锁文件有助于构建过程的可复现性。'],
  ['concurrency', '/kənˈkɜːrənsi/', '并发；多个任务在重叠时段内推进', 'Making progress on multiple tasks during overlapping periods.', 'Limit concurrency to avoid exhausting the connection pool.', '限制并发以免耗尽连接池。', 'Concurrency can improve responsiveness without parallel execution.', '即使没有并行执行，并发也可以改善响应性。'],
  ['backpressure', '/ˈbækˌpreʃər/', '背压；下游要求上游减慢数据生产', 'A signal to slow a producer when a consumer cannot keep up.', 'Apply backpressure when the queue reaches its limit.', '队列达到上限时施加背压。', 'Backpressure prevents a slow consumer from exhausting memory.', '背压可以防止缓慢的消费者耗尽内存。'],
  ['sandbox', '/ˈsændbɑːks/', '沙箱；用于隔离执行的受限环境', 'An isolated environment for controlled execution.', 'Run the generated script in a sandbox.', '在沙箱中运行生成的脚本。', 'The sandbox blocks access to private files.', '沙箱阻止访问私人文件。'],
  ['trade-off', '/ˈtreɪd ɔːf/', '权衡；为获得一种优势而接受另一种代价', 'A balance between benefits and costs.', 'Explain the trade-off between speed and accuracy.', '解释速度和准确率之间的权衡。', 'Caching introduces a trade-off between freshness and latency.', '缓存引入了数据新鲜度与延迟之间的权衡。'],
];
module.exports = entries.map(([word, phonetic, meaning, meaningEn, first, firstZh, second, secondZh]) => ({
  id: 'builtin:' + word, word, phonetic, meaning, meaningEn,
  examples: [{ text: first, translation: firstZh }, { text: second, translation: secondZh }],
  example: first, favorite: false, reviewCount: 0, intervalDays: 0, reviewAt: 0,
}));
