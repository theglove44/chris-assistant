# review-issue

Review a GitHub issue on the chris-assistant repo, validate it, and post a review comment.

## Usage
`/review-issue <issue-number>`

## Instructions

1. **Fetch the issue** from `theglove44/chris-assistant` using `gh issue view <number> --json title,body,labels,state,author,comments`

2. **Understand the context** — read relevant source files mentioned in or related to the issue. Use Grep/Glob to find the affected code.

3. **Validate the issue** by assessing:
   - Is the problem real and reproducible based on the code?
   - Is the description clear and actionable?
   - Are there any duplicates in open issues?
   - What's the severity/priority?

4. **Determine the action**:
   - **Needs PR**: The issue describes a valid bug or feature that requires code changes. Note what files/approach would be needed.
   - **Can be closed**: The issue is invalid, already fixed, a duplicate, or not actionable.
   - **Needs more info**: The issue lacks enough detail to act on.

5. **Post a review comment** on the issue using `gh issue comment <number>`. Format the comment as:

```
## Review

**Status**: [Valid — needs PR | Valid — minor fix | Invalid | Duplicate | Needs more info]
**Priority**: [High | Medium | Low]

### Analysis
[2-3 sentences on what was found reviewing the code]

### Recommendation
[What should be done — specific files/approach if a PR is needed, or why it should be closed]

---
*Reviewed by Claude Code*
```

6. **If the issue needs a PR**, ask the user if they want you to implement it now.

7. **If invalid or duplicate**, ask the user if they want you to close the issue.
