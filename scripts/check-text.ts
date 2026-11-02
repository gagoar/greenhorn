#!/usr/bin/env node
// check-text: deterministic checks on a text written for a newcomer. Node runs it as it is (version 22.18 or later):
// there is no build step and no binary. This file only starts the command; the code is in cli.ts.
import { run } from "./cli.ts";

const ARGS_START = 2; // argv holds the node binary and the script before the arguments

process.exitCode = run(process.argv.slice(ARGS_START));
