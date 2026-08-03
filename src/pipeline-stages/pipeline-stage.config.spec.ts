import { BadRequestException } from '@nestjs/common';
import { JobPipelineStage } from '../jobs/job-pipeline-stage.enum';
import { STAGE_ORDER } from '../jobs/pipeline-gate.rules';
import {
  defaultPipelineStageConfig,
  findStageConfig,
  mergePipelineStageConfig,
  mergePipelineStagePatch,
  validatePipelineStageConfig,
} from './pipeline-stage.config';

describe('pipeline stage config', () => {
  it('defaults to every enum stage in canonical order', () => {
    const config = defaultPipelineStageConfig();
    expect(config.stages.map((s) => s.id)).toEqual(STAGE_ORDER);
    expect(validatePipelineStageConfig(config)).toBeUndefined();
  });

  it('falls back to defaults for junk stored values', () => {
    expect(mergePipelineStageConfig(null)).toEqual(
      defaultPipelineStageConfig(),
    );
    expect(mergePipelineStageConfig({ stages: 'nope' })).toEqual(
      defaultPipelineStageConfig(),
    );
  });

  it('ignores stored stages that are not enum values', () => {
    const config = mergePipelineStageConfig({
      stages: [{ id: 'invented_stage', label: 'Nope' }],
    });
    expect(config.stages.map((s) => s.id)).toEqual(STAGE_ORDER);
  });

  it('keeps canonical order even when stored order differs', () => {
    const config = mergePipelineStageConfig({
      stages: [
        { id: JobPipelineStage.PAID, label: 'Money in' },
        { id: JobPipelineStage.LEAD, label: 'Enquiry' },
      ],
    });
    expect(config.stages[0].id).toBe(JobPipelineStage.LEAD);
    expect(config.stages[0].label).toBe('Enquiry');
    expect(config.stages.at(-1)?.label).toBe('Money in');
  });

  it('applies a partial patch and leaves other stages untouched', () => {
    const current = defaultPipelineStageConfig();
    const next = mergePipelineStagePatch(current, {
      stages: [
        { id: JobPipelineStage.LEAD, label: 'New enquiry', slaHours: 8 },
      ],
    });
    const lead = findStageConfig(next, JobPipelineStage.LEAD);
    expect(lead?.label).toBe('New enquiry');
    expect(lead?.slaHours).toBe(8);
    expect(findStageConfig(next, JobPipelineStage.QUOTED)).toEqual(
      findStageConfig(current, JobPipelineStage.QUOTED),
    );
  });

  it('rejects a patch naming an unknown stage', () => {
    expect(() =>
      mergePipelineStagePatch(defaultPipelineStageConfig(), {
        stages: [{ id: 'permit_filed', label: 'Permit filed' }],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects unknown top-level keys', () => {
    expect(() =>
      mergePipelineStagePatch(defaultPipelineStageConfig(), { stagez: [] }),
    ).toThrow(BadRequestException);
  });

  it('allows clearing an SLA with null', () => {
    const next = mergePipelineStagePatch(defaultPipelineStageConfig(), {
      stages: [{ id: JobPipelineStage.LEAD, slaHours: null }],
    });
    expect(findStageConfig(next, JobPipelineStage.LEAD)?.slaHours).toBeNull();
  });

  it('validates colours, labels and template ids', () => {
    const config = defaultPipelineStageConfig();
    config.stages[0].color = 'blue';
    expect(() => validatePipelineStageConfig(config)).toThrow(
      BadRequestException,
    );

    const withBadTemplate = defaultPipelineStageConfig();
    withBadTemplate.stages[0].taskTemplates = [
      {
        id: 'bad id!',
        title: 'x',
        dueOffsetHours: 1,
        priority: 'normal',
        assignTo: 'manager',
      },
    ];
    expect(() => validatePipelineStageConfig(withBadTemplate)).toThrow(
      BadRequestException,
    );
  });

  it('rejects duplicate template ids within a stage', () => {
    const config = defaultPipelineStageConfig();
    config.stages[0].taskTemplates = [
      {
        id: 'dup',
        title: 'a',
        dueOffsetHours: 1,
        priority: 'normal',
        assignTo: 'manager',
      },
      {
        id: 'dup',
        title: 'b',
        dueOffsetHours: 1,
        priority: 'normal',
        assignTo: 'manager',
      },
    ];
    expect(() => validatePipelineStageConfig(config)).toThrow(
      BadRequestException,
    );
  });

  it('normalises unknown template priority/assignee to safe defaults', () => {
    const next = mergePipelineStagePatch(defaultPipelineStageConfig(), {
      stages: [
        {
          id: JobPipelineStage.LEAD,
          taskTemplates: [
            {
              id: 't1',
              title: 'Call',
              dueOffsetHours: 2,
              priority: 'catastrophic',
              assignTo: 'the_dog',
            },
          ],
        },
      ],
    });
    const template = findStageConfig(next, JobPipelineStage.LEAD)
      ?.taskTemplates[0];
    expect(template?.priority).toBe('normal');
    expect(template?.assignTo).toBe('manager');
  });
});
