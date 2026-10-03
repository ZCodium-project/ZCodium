# Anti-patterns

These are known bad behaviors. Do not do them.

1. Treat every WRITE task as a dotnet task
2. Route formal CREATE_DOCX through pandoc because the source started as Markdown / LaTeX / HTML
3. Mutate zipped OOXML with raw string replace
4. Deliver template work without rendered inspection
5. Fill placeholders before checking anchor atomicity
6. Use `<skill_dir>` docs with `$0` or `readlink` path tricks
7. Silently switch backend after a gate fails
8. Insert content with a non-unique locator
9. Use local XML patching for section/header/footer/numbering graph work
10. Say “looks fine” without the acceptance profile that the task requires
