/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {Program, program} from '@romejs/js-ast';
import {Diagnostics, DiagnosticSuppressions} from '@romejs/diagnostics';
import {TransformRequest, TransformVisitors} from '../types';
import {stageTransforms, stageOrder, hookVisitors} from '../transforms/index';
import {Cache} from '@romejs/js-compiler';
import Context from '../lib/Context';

type TransformResult = {
  ast: Program;
  suppressions: DiagnosticSuppressions;
  diagnostics: Diagnostics;
  cacheDependencies: Array<string>;
};

const transformCaches: Array<Cache<TransformResult>> = stageOrder.map(() =>
  new Cache()
);

export default async function transform(
  req: TransformRequest,
): Promise<TransformResult> {
  const stage = req.stage === undefined ? 'compile' : req.stage;

  const {options, project} = req;
  let ast: Program = req.ast;

  const cacheQuery = Cache.buildQuery(req);

  const stageNo = stageOrder.indexOf(stage);

  // Check this exact stage cache
  const stageCache = transformCaches[stageNo];
  const cached: undefined | TransformResult = stageCache.get(cacheQuery);
  if (cached !== undefined) {
    return cached;
  }

  let prevStageDiagnostics: Diagnostics = [];
  let prevStageCacheDeps: Array<string> = [];

  // Run the previous stage
  if (stageNo > 0) {
    const prevStage = await transform({...req, stage: stageOrder[stageNo - 1]});
    prevStageDiagnostics = prevStage.diagnostics;
    prevStageCacheDeps = prevStage.cacheDependencies;
    ast = prevStage.ast;
  }

  const context = new Context({
    ast,
    project,
    options,
    origin: {
      category: 'transform',
    },
  });

  const transformFactory = stageTransforms[stage];
  const transforms = transformFactory(project.config, options);

  let visitors: TransformVisitors = [
    ...hookVisitors,
    ...(await context.normalizeTransforms(transforms)),
  ];

  const compiledAst = program.assert(context.reduce(ast, visitors));

  const res: TransformResult = {
    suppressions: context.suppressions,
    diagnostics: [...prevStageDiagnostics, ...context.diagnostics],
    cacheDependencies: [
      ...prevStageCacheDeps,
      ...context.getCacheDependencies(),
    ],
    ast: compiledAst,
  };
  stageCache.set(cacheQuery, res);
  return res;
}
