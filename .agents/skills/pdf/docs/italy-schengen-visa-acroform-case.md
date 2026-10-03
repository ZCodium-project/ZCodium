# 合成示例：意大利签证 AcroForm 填写

本案例仅演示 PDF 字段映射。人物、证件、雇主和联系信息均为合成数据，不能用于提交真实申请。保留原 PDF，写入已有 AcroForm 字段；不要向正式表单增加封面或说明页。

示例文件：

- `../templates/form-fill-acroform/cases/italy-schengen-visa-example/field_values.case.json`
- `../templates/form-fill-acroform/cases/italy-schengen-visa-example/extract_pdfs_key_info.py`
- `../templates/form-fill-acroform/cases/italy-schengen-visa-example/USER-FINAL-SUMMARY.template.md`

## 使用步骤

1. 使用 `fill probe` 判断是否有 AcroForm。没有时按 forms-guide 中的 overlay 流程处理。
2. 使用 `fill inspect` 获取完整字段名、页码、类型、最大长度和 checkbox/radio 的可选值。每份表单都重新检查，不能照搬示例字段名。
3. 从用户提供的材料提取信息；未知值留空。示例中的 `EXAMPLE PERSON`、`TEST00000` 和占位联系方式全部替换成有来源的数据。
4. 日期按表单要求转换，Latin-only 字段使用对应拉丁字母文本。记录原值、来源及转换依据。
5. 以 `qname` 和 `page_no` 定位字段。相同短字段名可能分属不同父节点；不要仅凭短名写入。
6. 调用 `fill apply` 写入字段，验证页数、可读性和字段值。对非法字段、错误页码和无效选项应报错。
7. 用 `fill rasterize` 逐页核验文字和勾选状态；把照片、签名等非 AcroForm 项列为需本人完成。
8. 输出 PDF 和独立的填写说明，列出缺失信息。不要宣称未执行的视觉检查已经通过。

姓名、护照号、住址和联系方式应只保留在用户指定的本地任务目录中，不作为技能案例或提交材料保存。生成的已填写 PDF 不得提交到源码仓库。
