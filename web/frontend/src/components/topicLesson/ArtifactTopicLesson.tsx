import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { TopicLessonRecord } from "../../../../shared/topicPractice";
import { MathText } from "../math/MathText";

type ArtifactTopicLessonProps = {
  lesson: TopicLessonRecord;
};

export function ArtifactTopicLesson({ lesson }: ArtifactTopicLessonProps) {
  const navigate = useNavigate();
  const [exampleIndex, setExampleIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const example = lesson.examples[exampleIndex];
  const step = example.steps[stepIndex];

  useEffect(() => {
    setExampleIndex(0);
    setStepIndex(0);
  }, [lesson.taskId]);

  const diagram = useMemo(() => {
    const completed = example.steps.slice(0, stepIndex + 1).reverse().find((item) => item.diagramAsset);
    return completed?.diagramAsset || example.promptDiagramAsset;
  }, [example, stepIndex]);

  const chooseExample = (index: number) => {
    setExampleIndex(index);
    setStepIndex(0);
  };
  const lastStep = stepIndex === example.steps.length - 1;
  const lastExample = exampleIndex === lesson.examples.length - 1;
  const advance = () => {
    if (!lastStep) return setStepIndex((value) => value + 1);
    if (!lastExample) return chooseExample(exampleIndex + 1);
    navigate(`/practice/${lesson.taskId}`);
  };

  return (
    <div className="artifact-lesson-page">
      <header className="artifact-lesson-header">
        <div>
          <span className="eyebrow">学习 · TeX 教学投影</span>
          <h1>{lesson.title}</h1>
          <p>{lesson.objective}</p>
        </div>
        <span className="topic-source-badge">{lesson.sourceAssignments.length} 份 explanation TeX</span>
      </header>

      <nav className="artifact-example-tabs" aria-label="例题类型">
        {lesson.examples.map((item, index) => (
          <button key={item.id} type="button" className={index === exampleIndex ? "is-active" : ""} onClick={() => chooseExample(index)}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <MathText value={item.label} />
          </button>
        ))}
      </nav>

      {example.coreRules.length ? (
        <section className="artifact-core-rule">
          <span className="topic-panel-label"><MathText value={example.coreTitle || "核心规则"} /></span>
          {example.coreRules.map((rule, index) => <MathText key={index} value={rule} block />)}
        </section>
      ) : null}

      <main className="artifact-lesson-stage">
        <section className="artifact-lesson-object">
          <header>
            <span className="topic-panel-label"><MathText value={example.sectionTitle || example.label} /></span>
            <MathText value={example.stemLatex} block />
          </header>
          <div className={`artifact-lesson-visual ${diagram ? "has-diagram" : "is-equation"}`}>
            {diagram ? <img src={diagram} alt={`${example.label} 第 ${stepIndex + 1} 步图`} /> : <MathText value={step.contentLatex} block />}
          </div>
          <ol className="artifact-solution-trace">
            {example.steps.map((item, index) => (
              <li key={item.id} className={index < stepIndex ? "is-complete" : index === stepIndex ? "is-active" : "is-locked"}>
                <button type="button" onClick={() => setStepIndex(index)}>
                  <span>{index < stepIndex ? "✓" : index + 1}</span>
                  <div>
                    <strong>{item.title}</strong>
                    {index <= stepIndex ? <MathText value={item.contentLatex} block /> : null}
                  </div>
                </button>
              </li>
            ))}
          </ol>
        </section>

        <aside className="artifact-lesson-guide">
          <span className="ks-learn-step-label">当前解题动作</span>
          <h2>{step.title}</h2>
          <MathText value={step.contentLatex} block />
          {example.sideItems.length ? (
            <div className="artifact-side-notes">
              {example.sideItems.map((item, index) => (
                <article key={`${item.title}-${index}`} className={`is-${item.kind}`}>
                  <strong>{item.kind === "mistake" ? "易错 · " : "提示 · "}{item.title}</strong>
                  <MathText value={item.contentLatex} block />
                </article>
              ))}
            </div>
          ) : null}
          <div className="ks-learn-controls">
            <button className="btn btn-ghost" type="button" disabled={!stepIndex && !exampleIndex} onClick={() => stepIndex ? setStepIndex((value) => value - 1) : chooseExample(exampleIndex - 1)}>
              上一步
            </button>
            <button className="btn btn-primary" type="button" onClick={advance}>
              {lastStep && lastExample ? "开始训练" : lastStep ? "下一个例题" : "下一动作"}
            </button>
          </div>
        </aside>
      </main>
    </div>
  );
}
