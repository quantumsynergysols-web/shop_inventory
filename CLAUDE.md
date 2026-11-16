# Shop Inventory ERP

At the start of a session, read `HANDOFF.md` and continue from "Next steps"; update it before the session ends.

- Build to SRS v1.1 (link in `HANDOFF.md`). Cite requirement IDs (FR-…, BR-…) in code comments where a rule comes from the SRS.
- Money is whole paisa, quantities are whole thousandths of the base unit. No floats for either.
- Business rules live in `packages/domain` (pure, tested with `npm test`); the API only does I/O and transactions.
- The user writes in Roman Urdu; reply in Roman Urdu.
