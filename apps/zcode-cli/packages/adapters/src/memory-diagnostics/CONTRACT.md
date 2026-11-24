# CLI 内存诊断

app-server 就绪后用 CLI 入口根据已初始化产品数据根提供的目录调用 startCliMemoryDiagnostics，退出时调用 stop。
没有目录时跳过文件采样；采样器不得自行猜测 HOME 或回退到旧目录。
本模块独占 inspector 和诊断文件；只读取调用方提供的计数器，不持有会话或正文。
无 source map、脚本源码、调试端口、强制 GC 或完整堆快照。

采样与落盘单次在途，忙时丢样本。分配窗口、节点数、投影栈与文件大小都有上限。
跨进程只通过既有目录锁维护一份文件预算；锁竞争不排队，失败不传播到任务。
反馈归档按 shared 的 sanitizeCliMemoryDiagnostic 契约重新做安全投影。

完整参数和验收见 docs/monitoring/memory-diagnostics-log.md。
