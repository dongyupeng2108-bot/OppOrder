# Project Rules & Conventions

## Healthcheck Evidence Standards
(Added in Task 260208_023)

To ensure consistency and GitHub readability, all task submissions must strictly follow these healthcheck evidence rules:

1.  **File Naming & Path**:
    -   Must be located in: `rules/task-reports/YYYY-MM/` (derived from `task_id` YYMMDD_XXX).
    -   Must match exactly:
        -   `<task_id>_healthcheck_53122_root.txt`
        -   `<task_id>_healthcheck_53122_pairs.txt`

2.  **File Content**:
    -   **Encoding**: Must be ASCII/UTF-8 text. Files containing NUL bytes (`\x00`) (e.g., from PowerShell `>`) are invalid.
    -   **Validation**: Must contain `HTTP/x.x 200` (e.g., `HTTP/1.1 200 OK`).

3.  **Generation Command**:
    -   Use `curl.exe` with explicit output to avoid encoding issues.
    -   Example:
        ```powershell
        curl.exe -s -i http://localhost:53122/ --output rules/task-reports/2026-02/260208_023_healthcheck_53122_root.txt
        ```

## Gate Light Checks
-   `gate-light-check` will FAIL if any of the above rules are violated.
-   It performs a strict "Path + Content" validation on the latest task.
