---
name: GitHub workflow SSH heredocs
description: Bash heredoc terminators embedded in GitHub Actions SSH scripts must align with the YAML block indentation.
---

In a GitHub Actions `script: |` block, every Bash heredoc terminator must have exactly the block's base indentation after YAML parsing. Extra spaces make Bash consume the remainder of the SSH script and fail at the end, even when the optional branch is not executed.

**Why:** An optional reseller inspection block caused the VPS deployment to complete successfully but the SSH action to fail during final shell parsing because its `NODE` terminator was indented two spaces too far.

**How to apply:** When adding or merging inline Node/Python heredocs in workflow SSH scripts, inspect whitespace with `sed -n l`, run a shell/YAML syntax check where practical, and verify the workflow's final SSH step rather than relying only on build success.