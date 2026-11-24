# 图片预览编辑

图片原字节只读；transform 和标注历史由当前预览唯一持有，关闭或切图即销毁。
保存捕获 focused Composer receiver 后异步导出自然尺寸 PNG；接收方释放 scope 后必须拒绝旧 receiver。
`registerImageComposerTarget` 由 Composer 的附件 hook 注册，仍以既有 `addAttachmentFiles` 为唯一入队路径。
编辑器不持有上传队列，不发送消息，不调用主进程。缩放、选择和擦除均在自然像素坐标中进行。
详见 [spec](../../../../docs/ui/shared-image-preview-dialog.md)。
