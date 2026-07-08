# Review Methodology

Two-pass review of Java code changes: a **technical pass** for correctness, conventions, and test coverage, then a **semantics pass** (via subagent) for naming, clarity, and communication quality. This file defines *what to look for*; SKILL.md defines how findings are delivered.

Review depth varies by file type — everything in the diff is visible and thread-able, but not everything gets the same scrutiny:

- **Java** (`src/`, `test/`) — the deep pass: all Pass 1 rules below, plus the Pass 2 semantics subagent.
- **Vue/TS** (`vue/`) — a lighter conventions pass. When Vue files are in the diff, read `.claude/skills/vue-style-guide/SKILL.md` and check the changed files against it: project structure, component and module organization, naming, established patterns. The Java rules below don't apply here, and this isn't a line-by-line audit — flag convention violations and anything that jumps out, then move on.
- **Config and migrations** (Spring XML, Liquibase changelogs, properties files) — fair game if there's something worth flagging.
- **JSPs and tag files** (`war/WEB-INF/jsp/`, `war/WEB-INF/tags/`) — legacy UI, no methodical pass. Flag only what jumps out while reading them for context.

---

## Pass 1: Technical Review

This is the main pass. Work through each changed Java file methodically:

1. Read the diff hunks to understand what changed
2. Read surrounding context when the diff alone isn't sufficient — the full method, the class fields, related methods. Don't review blindly from a narrow diff window.
3. For new or modified methods, check for test coverage and dead code (details below)
4. Apply all technical rules

### 1. Test Coverage

New or modified repository query methods and static utility methods should have corresponding unit tests. Actually check — look in the `test/` directory, which mirrors the `src/` package structure.

For example, a new method in `src/com/intricategroup/is/repo/GasRateGorTestRepo.java` should have tests in `test/com/intricategroup/is/repo/GasRateGorTestRepoTest.java`.

When flagging a missing test:
- Name the expected test file location
- Briefly note what the test should cover (positive case, null/empty case, etc.)

Reminder for context: this project avoids Mockito due to Java module system incompatibilities. Tests use real objects. Repo tests extend `RepositoryTestCase` and hit a real database.

### 2. Static Method Eligibility

If a method doesn't access any instance fields or call any instance methods, it should probably be `static`. This isn't pedantic — it communicates to future readers that the method is self-contained and doesn't depend on object state. It also prevents accidental coupling later.

**Flag**: Instance methods that could be static — no `this` references, no instance field access, no calls to non-static methods on `this`.

### 3. Dead Code / Test-Only Methods

A method that exists only to be called from tests — and never from production code — is suspicious. It either represents unused functionality, or the test is validating an internal detail that shouldn't be public API.

For new methods introduced in the diff, grep across `src/` to confirm they're called from production code:
```bash
grep -r "methodName" src/ --include="*.java" -l
```

**Flag**: Methods only referenced from `test/` files. Note that just-introduced methods that are part of ongoing work are less concerning — use judgment.

### 4. Misplaced Logic (Method Boundary Issues)

Watch for code that appears just before or after a method call and would be needed every time that method is called. If the same setup or cleanup happens at every call site, that logic likely belongs inside the method.

Patterns to watch for:
- Null-checking or validating a return value the same way everywhere
- Transforming an argument into a specific form before every call
- Doing cleanup, logging, or state updates after every call
- Converting a result into a different type at every call site
- Empty-collection guards before a repository call — if every caller checks `list.isEmpty()` before calling a repo method, that guard belongs inside the repo method (or isn't needed at all, since `WHERE ... IN ()` just returns nothing)
- An if/else block in a controller that picks between two similar service calls based on a type — that branching likely belongs in the service as a single method

This is about recognizing when a method's contract is incomplete — when callers are forced to handle ceremony that the method itself should own.

**Flag**: Repeated pre/post patterns around a method call in the changed code, or logic clearly inseparable from the method's core responsibility.

### 5. EntityScope Usage

Always use the lowest scope that's sufficient:

| Scope | When to use |
|-------|------------|
| `ULTRALIGHT` | Only need id + label (dropdowns, references) |
| `LIGHT` | Core fields, no child entities |
| `FULL` | All fields and child entities — only when genuinely needed |
| `CACHED_FULL` | Full version served from cache |

**Flag**: `FULL` or `CACHED_FULL` used where the code only accesses fields available at a lighter scope. Look at what's actually accessed downstream of the fetch.

### 6. Enum Handling

The custom ORM handles enum serialization/deserialization natively. Enum fields should be passed as-is — never call `.toString()` on them.

**Flag**: `.toString()` on enum types, particularly in repository parameters, query building, or when setting entity fields.

### 7. Repository Conventions

Three rules to check:
- **Scope as parameter**: Repository methods should accept `EntityScope` as a parameter, not hardcode one internally.
- **getByQuery vs getMany**: Use `getByQuery` when a query is guaranteed to return at most one row (returns entity or null). Use `getMany` for multi-row results.
- **insertAndGet vs insert**: Use `insertAndGet(scope, entity)` when the caller needs the persisted entity back (with DB-generated fields like `id`). Use plain `insert` only when the return value isn't needed.

### 8. Service Layer

Don't wrap trivial repository reads in a service method. If a service method just delegates to a single repo call with no business logic added, the caller should use the repo directly.

Name methods `getOnly...` (e.g., `getOnlyByOwner`) when exactly one result is expected, to signal cardinality at the call site.

### 9. ErrorCollector and Validation

The `ErrorCollector` pattern has a few invariants that are easy to violate:

- **Creator calls goBoom()**: The method that instantiates the `ErrorCollector` must be the same method that calls `goBoom()`. Don't pass it into a helper and have the helper blow up.
- **Prefix ownership**: Whoever calls `setPrefix()` must call `clearPrefix()` afterward.
- **Transaction boundary**: A `RuntimeException` from `goBoom()` will mark a `@Transactional` boundary for rollback. If you intend to catch the exception, pass the `ErrorCollector` into called methods instead of letting the exception cross the boundary.
- **Single conditions**: For a single business rule violation, throw `new ValidationException("message")` directly — don't create an `ErrorCollector` for one check.
- **Programming errors**: Use `Contract` assertions (`Contract.notNull`, `Contract.assertTrue`, etc.) for invariants that indicate bugs, not bad user input.
- **State preconditions**: When a method mutates an entity in a way that assumes a certain state (e.g., setting a FK that should be null before being set), add a sanity check. If overwriting a non-null value would indicate a logic error, a `Contract` assertion or `ValidationException` should enforce it — don't silently overwrite.

### 10. Code Style

#### Formatting

- **Key-value alignment**: In patterns like `Util.map(...)`, field declarations, and annotation attributes, left-align values into columns for scannability.
- **Indented blank lines**: Blank lines separating code sections within a block should be indented to match the surrounding code — not completely empty.
- **Method call line-breaking**: When a call is too long for one line, break after `(`, indent all arguments one step, and put `)` on its own line at the original indentation. Don't hang-align arguments to `(`.
- **No nested ternaries**: If a ternary needs chaining, extract a helper method.
- **Model FK separation**: In model classes, visually separate FK/association field groups (e.g., `ownerId` + `ownerType`) from adjacent fields with blank lines.

#### Braces and Control Flow

- **Always brace ifs**: Never write braceless single-line if statements. Even one-liners need braces:
  ```java
  // Bad
  if (foo) doSomething();

  // Good
  if (foo) {
      doSomething();
  }
  ```
- **Explicit else on alternative returns**: When an `if` block returns (or throws), don't let the alternative path dangle as a bare statement after the block. Use an explicit `else` so both branches are visually parallel:
  ```java
  // Bad — the implicit else is easy to miss when scanning
  if (foo) {
      return x;
  }
  return y;

  // Good — both paths are explicitly branched
  if (foo) {
      return x;
  } else {
      return y;
  }
  ```
  This does not apply to early guard clauses at the top of a method (e.g., null checks that return/throw immediately). Guards are a different pattern — their purpose is to exit early so the main logic isn't nested. The rule applies when both branches represent substantive alternative paths.
- **Positive case first**: In if/else blocks, put the expected/happy path in the `if` and the exceptional case in `else`. The reader's eye expects the normal flow first.
- **Early returns must earn their place**: An early return is justified when it prevents a real problem — a null that would NPE, an invalid state that should throw, or when it significantly reduces nesting depth in a long method. But if the code below handles the edge case naturally on its own, the early return is just bloat. The classic bad case: checking `list.isEmpty()` and returning early right before a `for` loop — the loop handles empty by not executing.
  ```java
  // Unnecessary — the loop handles empty naturally
  if (entries.isEmpty()) {
      return;
  }
  for (GorScheduleEntry entry : entries) { ... }

  // Justified — deeply nested method where the guard prevents 3 levels of indentation
  if (!config.isFeatureEnabled()) {
      return;
  }
  // ... 40+ lines of complex logic with its own branching
  ```
  Also note: when a null check "guard" is needed, ask whether the right response is really a silent return, or whether it should throw. If the value being null indicates a bug, use `Contract.notNull` — don't hide the problem with a quiet return.

#### Data Flow and Streams

- **Prefer Util class over streams**: This codebase uses `Util` methods for data transformations rather than Java streams. Keep transformations simple — at most two chained operations on a single line. For anything more complex, break the work into sequential steps with descriptive local variables:
  ```java
  // Preferred — step by step with readable locals
  List<Ticket> activeTickets = Util.filter(tickets, Ticket::isActive);
  List<String> ticketNames = Util.map(activeTickets, Ticket::getName);

  // Avoid — stream chains
  List<String> ticketNames = tickets.stream()
      .filter(Ticket::isActive)
      .map(Ticket::getName)
      .collect(Collectors.toList());
  ```
- **Bulk queries outside loops**: Declare and fetch data collections near the top of the method when the results will be used inside a loop. Don't fetch per-iteration — pull once, use many:
  ```java
  // Good — one query, used in loop
  Map<Long, Customer> customerMap = c.customerRepo.getMapByIds(LIGHT, customerIds);
  for (Ticket ticket : tickets) {
      Customer customer = customerMap.get(ticket.getCustomerId());
      // ...
  }

  // Bad — query per iteration
  for (Ticket ticket : tickets) {
      Customer customer = c.customerRepo.getById(LIGHT, ticket.getCustomerId());
      // ...
  }
  ```
  Otherwise, declare variables close to their first use.

#### Naming and Comments

- **Boolean naming**: Flexible — `is`/`has`/`should`/`can` prefixes are encouraged but not required. Names like `active`, `enabled`, `visible` are fine.
- **Field comments**: Comment non-obvious fields in model classes (where the name + type doesn't convey purpose). Pay special attention to *pairs* of related fields whose relationship is non-obvious — if two fields appear to track overlapping state, a comment should explain why both exist and when each is the source of truth. But if a field needs a comment, also consider whether a better name would eliminate the need for one.
- **No TODOs in new code**: New code shouldn't ship with TODO or FIXME comments. Either address it now or create a ticket. Flag these mainly as a reminder.

#### Other Conventions

- **Explicit imports**: Use explicit imports, not wildcards. The exception is files like `Context.java` where the import count would be enormous.
- **For-each by default**: Use enhanced for-each loops unless you genuinely need the index.
- **Access modifiers — most restrictive**: Default to `private`. Only widen to `protected` or `public` when something actually needs the access. Helpers should be private unless there's a concrete reason otherwise.
- **Catch specific exception types**: Avoid bare `catch (Exception e)`. Catch the narrowest type that matches the failure mode.
- **Collections never return null**: Methods returning a `List`, `Set`, or `Map` should return an empty collection rather than `null`. Callers shouldn't need to null-check a collection.

### 11. Request Binding

Controllers that bind many request parameters to an entity manually (parsing each field, null-checking, calling setters) should use a `SimpleEntityBinder` subclass instead. `SimpleEntityBinder` (`com.intricategroup.erp.model.binder.SimpleEntityBinder`) uses reflection to automatically map request parameters to entity setters, handling type conversion, phone numbers, amounts, and file attachments. A subclass can override behavior for specific fields.

When a controller method has a block of ~5+ sequential `request.getParameter` / `RequestUtil.parse*` calls followed by conditional setter calls, that's a sign a binder should be used instead.

**Flag**: Controller methods that manually bind many fields from the request when a binder would be cleaner.

### 12. General Quality

Beyond the specific rules above, flag anything that jumps out:

- Null safety issues in new code
- Resource leaks (unclosed streams, connections)
- Thread safety problems with shared mutable state
- Magic numbers or strings with non-obvious meaning (common values like 0, 1, empty string don't need constants — only flag values whose meaning isn't self-evident)
- Unnecessary object creation in hot paths or loops
- Methods over ~80 lines that would benefit from extraction
- Parameters — when a method takes many parameters (5+), flag for discussion as a potential improvement area
- **Denormalized fields**: When a model stores data that could be derived from other fields or related entities, flag the denormalization risk. Stored-but-derivable fields require coordinated updates — if the source changes, every copy must be updated in lockstep, which is a maintenance and bug surface. Not all denormalization is wrong (performance may justify it), but it should be a conscious choice, not an accident.
- **Silent edge cases**: When code silently handles what might be an unexpected state — e.g., `if (x == null) { continue; }` in a loop — question whether the null represents a legitimate case or a bug. If a null value at that point indicates corrupted data or a programming error, the code should throw or log a warning, not silently skip.

Use judgment on severity — not everything needs to be flagged.

---

## Pass 2: Semantics Review (Subagent)

After completing the technical pass, spawn a subagent to do a focused reading of the changed code for naming, clarity, and communication quality. This pass catches things the technical rules miss — vague verbs, misleading names, javadoc that doesn't match reality, methods whose names don't reflect their actual scope.

The subagent should receive:
1. The full diff (or file-by-file diffs for large changes)
2. Surrounding context for any files where the diff alone is insufficient (read the full class or relevant methods)

Spawn the subagent with `subagent_type: "general-purpose"` and the following prompt structure (adapt the diff command and file list to match the actual review):

```
You are reviewing Java code changes for naming quality, semantic clarity, and communication.
This is NOT a technical review — bugs, test coverage, and style conventions are handled separately.
Your job is to read the code as a human would and flag anything where the words don't accurately
communicate what the code does.

## What to look for

### Method and variable naming
- Vague, low-information verbs: "link", "process", "manage", "handle", "do", "run", "execute"
  when a more precise verb exists. The right verb encodes constraints — "claim" implies exclusivity
  that "link" does not; "reconcile" implies two-sided comparison that "sync" does not.
- Names that are too generic for their actual scope. If a method only serves one specific consumer
  or context, the name should hint at that — a generic name invites misuse.
- Names that promise more or less than the method delivers.

### Javadoc and comment accuracy
- Comments that describe behavior the code doesn't actually have.
- Comments that use terminology not reflected in the code (or vice versa).
- Javadoc on a method that was true when written but no longer matches the implementation.
  Read the actual code, not just the doc — flag divergence.

### Semantic consistency
- The same concept referred to by different names in different places (e.g., "linked" in one method,
  "assigned" in another, "attached" in a third — when they all mean the same thing).
- Fields or parameters whose names suggest a different type or cardinality than they actually have.

### Communication through code structure
- A method that does something non-obvious where a better name would eliminate the need for
  the explanation. Comments compensating for weak names are a sign.
- Return types or parameter types that obscure the method's contract.
- Boolean parameters that don't clearly communicate what true/false mean at the call site.

## What NOT to flag
- Style issues (formatting, braces, import order)
- Technical bugs, null safety, performance
- Missing tests
- Anything that requires running or grepping the codebase

## Output format

Group by file. Use severity levels:
- **SHOULD FIX** — Name is misleading or vague enough to cause confusion
- **CONSIDER** — A better name exists but the current one isn't wrong

Format:
### path/to/File.java
1. **[SHOULD FIX]** Line 42 — Descriptive title
   What's unclear and what would be better.

If there are no findings, say so. Don't manufacture issues.

## The diff to review

<paste diff or instructions to read files here>
```

**Important**: The subagent must read files directly to get sufficient context — don't just paste isolated diff hunks. For each file with changes, have it read the full class (or at minimum the changed methods plus their surrounding context). Naming issues are impossible to judge from a narrow window.

---

## Pre-existing Issues

If either pass notices problems in surrounding code that aren't part of the diff but were spotted while reading context, surface them as drive-by observations — clearly labeled as pre-existing so they don't read as criticism of the change under review.
