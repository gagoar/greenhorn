#!/usr/bin/env node
// verify-reader: checks the output of the fresh reader of the verify pass and counts which stumbles come back.
// Node runs it as it is (version 22.18 or later). This file only starts the command; the code is in verify-cli.ts.
import { run } from "./verify-cli.ts";

const ARGS_START = 2; // argv holds the node binary and the script before the arguments

process.exitCode = run(process.argv.slice(ARGS_START));
