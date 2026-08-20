# TODO

- [ ] Add LLM-call auditing: record redacted request metadata, prompt/input fingerprints, timing phases, provider request IDs, response status, usage/cost, retries, and failure details for every outbound call without storing credentials.
- [ ] Add frontier LLM synth data gen - right now only nvidia data designer actually works
- [ ] Retry logic for various gen
- [ ] On Data Forge - review the "button" names like "all slots filled'
- [ ] Canary vs. train
- [ ] Fix the semantic status bug where a failed environment evaluation can still close its job as succeeded; make terminal job status reflect errored evaluation results.
