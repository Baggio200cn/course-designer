import React from 'react';
import ArtifactPanel from './ArtifactPanel';

export default function FrameworkStage(props) {
  const {
    assistantStatus,
    requirementText,
    setRequirementText,
    busy,
    busyKey,
    frameworkRecord,
    handleGenerateFramework,
    saveFrameworkStage,
    handleConfirmFramework,
    handleExportFrameworkWord,
    editorData,
    updateCourseInfo,
    updateObjective,
    updateTeachingMethod,
    updatePolitics,
    addModule,
    removeModule,
    updateModuleField,
    handleGenerateInfographic,
    handleConfirmInfographic,
    infographicBusyKey,
    infographicLayout,
    setInfographicLayout,
    infographicStyle,
    setInfographicStyle,
    handleGenerateDiagram,
    diagramBusy,
    diagramResult,
    handleExportKnowledgeCards,
    handleExportInteractiveCards,    // Phase-7.7 A3-C：互动测试卡片
    addSchedule,
    removeSchedule,
    updateSchedule,
    preview,
    rightTab,
    setRightTab,
    rawJsonText,
    setRawJsonText,
    rawJsonError,
    handleSaveRawJson,
    buildFrameworkFromEditor,
    notebook,
    frameworkVersions,
    selectedNotebookId,
    api,
    loadFrameworkStage,
    setAssistantStatus,
    markdownBlocks,
    artifacts,
    dt,
    toLocalImgSrc,
    arr
  } = props;
  const modules = arr(editorData.modules);
  const confirmedInfographicCount = modules.filter((item) => item.content?.structureImagePath || item.content?.structureImageUrl).length;
  const pendingInfographicCount = modules.length - confirmedInfographicCount;
  const updateModuleContentField = (index, patch = {}) => {
    const moduleItem = editorData.modules[index] || {};
    updateModuleField(index, 'content', {
      ...(moduleItem.content || {}),
      ...(patch || {})
    });
  };

  // AI 生成框架期间：在整个编辑区上方覆盖遮罩，防止旧内容误导用户
  const isGenerating = busyKey === 'framework-generate';

  return (
    <section className="v2-stage-layout" style={{ position: 'relative' }}>
      {isGenerating && (
        <div className="v2-stage-generating-mask">
          <div className="v2-stage-generating-card">
            <div className="v2-stage-generating-spinner" />
            <div className="v2-stage-generating-title">正在生成教学框架…</div>
            <div className="v2-stage-generating-hint">AI 正在根据课程信息生成完整的框架 JSON，请稍候</div>
          </div>
        </div>
      )}
      <div className="v2-stage-center">
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>课程开发助手</h3>
            <span className="v2-hint">这里只保留本轮需求输入，不再显示聊天历史流。</span>
          </div>
          <div className="v2-status-box">
            <span>助手状态</span>
            <strong>{assistantStatus}</strong>
          </div>
          <div className="v2-status-box">
            <span>当前操作顺序</span>
            <strong>{`先检查并确认模块信息图，再确认当前框架解锁讲稿。已确认信息图 ${confirmedInfographicCount}/${modules.length || 0}`}</strong>
          </div>
          <label className="v2-label">本轮需求</label>
          <textarea value={requirementText} onChange={(e) => setRequirementText(e.target.value)} rows={6} />
          <div className="v2-inline-actions">
            <button className="v2-btn v2-btn-primary" onClick={handleGenerateFramework} disabled={busy}>
              {busy ? '处理中...' : frameworkRecord ? '重写框架' : '生成框架'}
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={() => saveFrameworkStage()}>保存当前修改</button>
            <button className="v2-btn v2-btn-secondary" onClick={() => saveFrameworkStage({ previewOnly: true })}>同步右侧预览</button>
            <button className="v2-btn v2-btn-secondary" onClick={handleConfirmFramework}>确认当前框架</button>
            <button className="v2-btn v2-btn-secondary" onClick={handleExportFrameworkWord}>导出 Word</button>
          </div>
        </div>

        <div className="v2-stage-banner stage-framework">
          <div className="v2-stage-banner-copy">
            <span>框架主链</span>
            <strong>先成框架，再补信息图，再确认并解锁下游。</strong>
            <p>信息图确认数量会直接影响框架发布完整度，但不会误锁死讲稿阶段。</p>
          </div>
          <div className="v2-metric-grid">
            <div className="v2-metric-card">
              <span>模块总数</span>
              <strong>{modules.length}</strong>
            </div>
            <div className="v2-metric-card">
              <span>已确认信息图</span>
              <strong>{confirmedInfographicCount}</strong>
            </div>
            <div className="v2-metric-card">
              <span>待确认模块</span>
              <strong>{pendingInfographicCount}</strong>
            </div>
          </div>
        </div>

        <div className="v2-panel">
          <h3>课程信息卡</h3>
          <div className="v2-grid-two">
            <div>
              <label className="v2-label">课程名称</label>
              <input value={editorData.courseInfo.courseName} onChange={(e) => updateCourseInfo('courseName', e.target.value)} />
            </div>
            <div>
              <label className="v2-label">专业代码</label>
              <input value={editorData.courseInfo.courseCode} onChange={(e) => updateCourseInfo('courseCode', e.target.value)} />
            </div>
            <div>
              <label className="v2-label">授课对象</label>
              <input value={editorData.courseInfo.targetGrade} onChange={(e) => updateCourseInfo('targetGrade', e.target.value)} />
            </div>
            <div>
              <label className="v2-label">先修课程</label>
              <input value={editorData.courseInfo.prerequisite} onChange={(e) => updateCourseInfo('prerequisite', e.target.value)} />
            </div>
            <div>
              <label className="v2-label">总学时</label>
              <input type="number" value={editorData.courseInfo.totalHours} onChange={(e) => updateCourseInfo('totalHours', e.target.value)} />
            </div>
            <div>
              <label className="v2-label">理论学时</label>
              <input type="number" value={editorData.courseInfo.theoryHours} onChange={(e) => updateCourseInfo('theoryHours', e.target.value)} />
            </div>
            <div>
              <label className="v2-label">实践学时</label>
              <input type="number" value={editorData.courseInfo.practiceHours} onChange={(e) => updateCourseInfo('practiceHours', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="v2-panel">
          <h3>教学目标卡</h3>
          <div className="v2-goal-edit-grid">
            <div>
              <label className="v2-label">知识目标</label>
              <textarea rows={5} value={arr(editorData.objectives.knowledge).join('\n')} onChange={(e) => updateObjective('knowledge', e.target.value)} />
            </div>
            <div>
              <label className="v2-label">技能目标</label>
              <textarea rows={5} value={arr(editorData.objectives.skills).join('\n')} onChange={(e) => updateObjective('skills', e.target.value)} />
            </div>
            <div>
              <label className="v2-label">素养目标</label>
              <textarea rows={5} value={arr(editorData.objectives.attitude).join('\n')} onChange={(e) => updateObjective('attitude', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="v2-panel">
          <h3>教学方法与思政元素</h3>
          <div className="v2-grid-two">
            <div>
              <label className="v2-label">主要教学方法</label>
              <input value={editorData.teachingMethods.primary} onChange={(e) => updateTeachingMethod('primary', e.target.value)} />
            </div>
            <div>
              <label className="v2-label">辅助教学方法（每行一项）</label>
              <textarea rows={4} value={arr(editorData.teachingMethods.secondary).join('\n')} onChange={(e) => updateTeachingMethod('secondary', e.target.value)} />
            </div>
            <div>
              <label className="v2-label">工匠精神</label>
              <textarea rows={4} value={editorData.ideologicalElements.craftsmanship} onChange={(e) => updatePolitics('craftsmanship', e.target.value)} />
            </div>
            <div>
              <label className="v2-label">文化自信</label>
              <textarea rows={4} value={editorData.ideologicalElements.culturalConfidence} onChange={(e) => updatePolitics('culturalConfidence', e.target.value)} />
            </div>
          </div>
          <div className="v2-field-top-gap">
            <label className="v2-label">其他思政元素</label>
            <textarea rows={4} value={editorData.ideologicalElements.other} onChange={(e) => updatePolitics('other', e.target.value)} />
          </div>
        </div>

        {/* ── Phase baoyu-A/B/C：结构图 + 信息图风格 + 知识点卡片 ── */}
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>🎨 课程可视化工具</h3>
          </div>

          {/* A：SVG 教学结构图 */}
          <div style={{ marginBottom: 16 }}>
            <label className="v2-label">📊 教学结构图（SVG，精准高速，无图像费用）</label>
            <div className="v2-inline-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
              {[
                { type: 'mindmap',   label: '🧠 思维导图' },
                { type: 'magazine',  label: '📰 杂志信息图' }
              ].map(({ type, label }) => (
                <button
                  key={type}
                  className="v2-btn v2-btn-xs"
                  onClick={() => handleGenerateDiagram(type)}
                  disabled={diagramBusy || busy}
                  title={`生成 ${label} SVG 矢量图`}
                >
                  {diagramBusy ? '生成中…' : label}
                </button>
              ))}
            </div>
            {diagramResult && (
              <div style={{ marginTop: 10, border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', background: '#FAFBFF' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#EEF2FF', fontSize: 12, color: '#475569' }}>
                  <span>✅ {diagramResult.diagramType} 结构图已生成</span>
                  <a
                    href={diagramResult.svgDataUri}
                    download={`diagram-${diagramResult.diagramType}.svg`}
                    style={{ color: '#2E86DE', textDecoration: 'none', fontWeight: 600 }}
                  >
                    ⬇ 下载 SVG
                  </a>
                </div>
                <img
                  src={diagramResult.svgDataUri}
                  alt="教学结构图"
                  style={{ width: '100%', display: 'block', maxHeight: 500, objectFit: 'contain' }}
                />
              </div>
            )}
          </div>

          {/* B：信息图布局/风格选择器 */}
          {/* Phase-8.5：原"信息图设置"全局区块已移除——所有模块信息图统一走 magazine_module 杂志风格，不再支持手动选布局/风格 */}

          {/* C：知识点卡片导出 */}
          <div>
            <label className="v2-label">📚 知识点卡片导出（一键生成全课程知识点汇总页）</label>
            <div className="v2-inline-actions">
              <button
                className="v2-btn v2-btn-secondary"
                onClick={handleExportKnowledgeCards}
                disabled={busy}
                title="将所有模块的知识点生成精美 HTML 卡片页，可在浏览器打印或截图分享"
              >
                📤 导出知识点卡片 HTML
              </button>
            </div>
            <p className="v2-field-note">生成自包含 HTML 文件，可在浏览器 Ctrl+P 打印，或截图发给学生。</p>
          </div>

          {/* Phase-7.7 A3-C：互动测试卡片（学生端 HTML，含翻卡 + 自检小测 + 进度追踪）*/}
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed #d1d5db' }}>
            <label className="v2-label">🎮 互动测试卡片（课堂/课后用）</label>
            <div className="v2-inline-actions">
              <button
                className="v2-btn v2-btn-primary"
                onClick={handleExportInteractiveCards}
                disabled={busy}
                title="导出含翻卡、学习标记、自检小测、进度追踪的互动 HTML 文件，老师可在课堂大屏展示，或发给学生在手机/电脑上自学"
                style={{ background: '#7c3aed', borderColor: '#7c3aed' }}
              >
                🎮 导出互动测试卡片（学生端）
              </button>
            </div>
            <p className="v2-field-note">
              互动版含翻卡（点击查看详情）、学习标记（"我学会了"按钮）、每模块自检小测、进度追踪。
              <br/>
              💡 用法：① 老师课堂大屏展示带学生互动；② 课后发链接/文件给学生在手机/电脑上自学，进度本地保存（LocalStorage）。
            </p>
          </div>
        </div>

        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>教学模块卡</h3>
            <button className="v2-btn v2-btn-secondary" onClick={addModule}>新增模块</button>
          </div>
          <p className="v2-field-note">
            这里就是教学框架稿与信息图匹配的入口。每个模块先点"生成信息图"，检查预览后再点"确认使用"，最后回到顶部或右侧确认当前框架。
          </p>
          <div className="v2-module-editor-list">
            {editorData.modules.length ? editorData.modules.map((moduleItem, index) => {
              const confirmedImage = moduleItem.content?.structureImagePath || moduleItem.content?.structureImageUrl || '';
              const draftImage = moduleItem.content?.v2DraftInfographicWorkspaceImagePath || moduleItem.content?.v2DraftInfographicPath || '';
              const previewImage = confirmedImage || draftImage;
              return (
                <div key={moduleItem.id || `${moduleItem.moduleNumber}-${index}`} className="v2-module-card v2-module-card-editor">
                  <div className="v2-panel-head">
                    <strong>{`模块 ${moduleItem.moduleNumber || index + 1}`}</strong>
                    <button className="v2-btn v2-btn-xs" onClick={() => removeModule(index)}>删除</button>
                  </div>
                  <div className="v2-grid-two">
                    <div>
                      <label className="v2-label">模块序号</label>
                      <input type="number" value={moduleItem.moduleNumber} onChange={(e) => updateModuleField(index, 'moduleNumber', e.target.value)} />
                    </div>
                    <div>
                      <label className="v2-label">学时</label>
                      <input type="number" value={moduleItem.hours} onChange={(e) => updateModuleField(index, 'hours', e.target.value)} />
                    </div>
                  </div>
                  <label className="v2-label">模块名称</label>
                  <input value={moduleItem.name} onChange={(e) => updateModuleField(index, 'name', e.target.value)} />
                  <label className="v2-label">模块说明</label>
                  <textarea rows={3} value={moduleItem.description} onChange={(e) => updateModuleField(index, 'description', e.target.value)} />
                  <label className="v2-label">知识要点（每行一项）</label>
                  <textarea rows={4} value={arr(moduleItem.knowledgePoints).join('\n')} onChange={(e) => updateModuleField(index, 'knowledgePoints', e.target.value)} />
                  <label className="v2-label">教学方法</label>
                  <input value={moduleItem.teachingMethods} onChange={(e) => updateModuleField(index, 'teachingMethods', e.target.value)} />
                  <label className="v2-checkbox-row">
                    <input type="checkbox" checked={Boolean(moduleItem.isCore)} onChange={(e) => updateModuleField(index, 'isCore', e.target.checked)} />
                    <span>核心模块</span>
                  </label>
                  <div className="v2-module-infographic">
                    <div className="v2-panel-head">
                      <span className="v2-label">📰 模块信息图（杂志风格）</span>
                      <div className="v2-inline-actions" style={{ flexWrap: 'wrap', gap: 6 }}>
                        {/* Phase-8.5：删除布局/风格选择器，统一走 magazine_module 杂志风格 */}
                        <button
                          className="v2-btn v2-btn-xs v2-btn-primary"
                          onClick={() => handleGenerateInfographic(moduleItem)}
                          disabled={infographicBusyKey === String(moduleItem.id) || infographicBusyKey === `confirm-${moduleItem.id}`}
                          title="按杂志风格生成本模块的信息图"
                        >
                          {infographicBusyKey === String(moduleItem.id) ? '生成中...' : confirmedImage ? '🔄 重新生成' : '🪄 生成信息图'}
                        </button>
                        <button
                          className="v2-btn v2-btn-xs"
                          onClick={() => handleConfirmInfographic(moduleItem)}
                          disabled={infographicBusyKey === String(moduleItem.id) || infographicBusyKey === `confirm-${moduleItem.id}`}
                        >
                          {infographicBusyKey === `confirm-${moduleItem.id}` ? '确认中...' : '✓ 确认使用'}
                        </button>
                        {previewImage ? (
                          <button
                            className="v2-btn v2-btn-xs"
                            onClick={() => api.openResource(moduleItem.content?.v2DraftInfographicWorkspaceImagePath || moduleItem.content?.v2DraftInfographicPath || confirmedImage)}
                          >
                            👁 打开预览
                          </button>
                        ) : null}
                        {moduleItem.content?.v2DraftInfographicHtmlPath ? (
                          <button
                            className="v2-btn v2-btn-xs"
                            onClick={() => api.openResource(moduleItem.content?.v2DraftInfographicHtmlPath)}
                          >
                            📄 打开 HTML
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <label className="v2-label">信息图提示词</label>
                    <textarea
                      rows={6}
                      placeholder={'生成后这里会保留原始提示词。你可以直接修改后，再点"生成信息图"重新出图。'}
                      value={moduleItem.content?.v2DraftInfographicPrompt || ''}
                      onChange={(e) => updateModuleContentField(index, { v2DraftInfographicPrompt: e.target.value })}
                    />
                    <p className="v2-field-note">
                      先检查草稿图是否正确，再根据上面的提示词继续微调，满意后点击"确认使用"写回教学框架。
                    </p>
                    {previewImage ? (
                      <div className="v2-inline-infographic-preview">
                        <img src={toLocalImgSrc(previewImage)} alt={moduleItem.name || '模块信息图'} />
                        <div>
                          <strong>{confirmedImage ? '已确认信息图' : '待确认预览图'}</strong>
                          <p>{confirmedImage ? '该图已绑定到当前教学框架。你仍可改提示词后重新生成，再重新确认。' : '请先检查草稿图，再点"确认使用"。'}</p>
                          {moduleItem.content?.v2DraftInfographicPrompt ? (
                            <div className="v2-note-box">
                              <strong>当前使用提示词</strong>
                              <p>{moduleItem.content?.v2DraftInfographicPrompt}</p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : <p className="v2-hint">当前模块还没有信息图。</p>}
                  </div>
                </div>
              );
            }) : <p className="v2-hint">当前还没有模块，请先生成或手动新增。</p>}
          </div>
        </div>

        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>教学进度表卡</h3>
            <button className="v2-btn v2-btn-secondary" onClick={addSchedule}>新增环节</button>
          </div>
          <div className="v2-schedule-editor-list">
            {editorData.schedule.length ? editorData.schedule.map((item, index) => (
              <div key={`${item.week}-${index}`} className="v2-schedule-card v2-schedule-card-editor">
                <div className="v2-panel-head">
                  <strong>{`环节 ${index + 1}`}</strong>
                  <button className="v2-btn v2-btn-xs" onClick={() => removeSchedule(index)}>删除</button>
                </div>
                <div className="v2-grid-three">
                  <div>
                    <label className="v2-label">周次/序号</label>
                    <input type="number" value={item.week} onChange={(e) => updateSchedule(index, { week: Number(e.target.value) || 0 })} />
                  </div>
                  <div>
                    <label className="v2-label">学时</label>
                    <input type="number" value={item.hours} onChange={(e) => updateSchedule(index, { hours: Number(e.target.value) || 0 })} />
                  </div>
                  <div>
                    <label className="v2-label">主题</label>
                    <input value={item.topic} onChange={(e) => updateSchedule(index, { topic: e.target.value })} />
                  </div>
                </div>
                <label className="v2-label">教学方法</label>
                <input value={item.methods} onChange={(e) => updateSchedule(index, { methods: e.target.value })} />
                <label className="v2-label">任务/作业</label>
                <textarea rows={3} value={item.assignment} onChange={(e) => updateSchedule(index, { assignment: e.target.value })} />
              </div>
            )) : <p className="v2-hint">当前还没有教学进度表，可按课堂环节逐条补充。</p>}
          </div>
        </div>
      </div>

      <div className="v2-stage-right">
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>预览与高级视图</h3>
            <div className="v2-inline-actions">
              <button className={`v2-btn ${rightTab === 'preview' ? 'v2-btn-primary' : 'v2-btn-secondary'}`} onClick={() => setRightTab('preview')}>结构化预览</button>
              <button className={`v2-btn ${rightTab === 'json' ? 'v2-btn-primary' : 'v2-btn-secondary'}`} onClick={() => setRightTab('json')}>原始 JSON</button>
            </div>
          </div>
          {rightTab === 'preview' ? (
            <>
              <div className="v2-kv-grid">
                {preview.courseInfo.map(([label, value]) => (
                  <div key={label} className="v2-kv-card">
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <div className="v2-goal-grid">
                {preview.objectives.map((group) => (
                  <div key={group.label} className="v2-goal-card">
                    <h4>{group.label}</h4>
                    {group.items.length ? <ul>{group.items.map((item, index) => <li key={`${group.label}-${index}`}>{item}</li>)}</ul> : <p className="v2-hint">暂无内容</p>}
                  </div>
                ))}
              </div>
              <div className="v2-preview-section">
                <h4>教学模块</h4>
                {preview.modules.length ? preview.modules.map((item) => (
                  <div key={item.key} className="v2-preview-card">
                    <strong>{item.title}</strong>
                    <span>{`${item.hours} 学时`}</span>
                    <p>{item.summary || '暂无模块说明'}</p>
                    {item.infographic ? <em>已绑定信息图</em> : item.infographicDraft ? <em>有待确认信息图</em> : null}
                  </div>
                )) : <p className="v2-hint">暂无模块</p>}
              </div>
              <div className="v2-preview-section">
                <h4>教学方法</h4>
                {preview.methods.length ? <ul>{preview.methods.map((item, index) => <li key={`method-${index}`}>{item}</li>)}</ul> : <p className="v2-hint">暂无内容</p>}
              </div>
              <div className="v2-preview-section">
                <h4>思政元素</h4>
                {preview.politics.length ? <ul>{preview.politics.map((item, index) => <li key={`politics-${index}`}>{item}</li>)}</ul> : <p className="v2-hint">暂无内容</p>}
              </div>
              <div className="v2-preview-section">
                <h4>教学进度表</h4>
                {preview.schedule.length ? preview.schedule.map((item) => (
                  <div key={item.key} className="v2-schedule-card">
                    <strong>{item.title}</strong>
                    <span>{item.meta}</span>
                    <p>{item.summary || '暂无说明'}</p>
                  </div>
                )) : <p className="v2-hint">暂无进度安排</p>}
              </div>
            </>
          ) : (
            <>
              <textarea className="v2-code" rows={28} value={rawJsonText} onChange={(e) => setRawJsonText(e.target.value)} />
              <div className={`v2-json-status ${rawJsonError ? 'error' : 'ok'}`}>
                {rawJsonError ? `JSON 错误：${rawJsonError}` : 'JSON 可保存'}
              </div>
              <div className="v2-inline-actions">
                <button className="v2-btn v2-btn-primary" onClick={handleSaveRawJson}>保存 JSON</button>
                <button className="v2-btn v2-btn-secondary" onClick={() => setRawJsonText(JSON.stringify(buildFrameworkFromEditor(editorData, notebook), null, 2))}>从卡片重置</button>
              </div>
            </>
          )}
        </div>

        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>框架版本历史</h3>
            <span className="v2-hint">以数据库里当前教学框架版本为准。</span>
          </div>
          <div className="v2-version-list">
            {frameworkVersions.length ? frameworkVersions.map((item) => (
              <div key={item.id} className={`v2-version-item ${frameworkRecord?.id === item.id ? 'active' : ''}`}>
                <div>
                  <strong>{`版本 ${item.version || '-'}`}</strong>
                  <span>{dt(item.updatedAt || item.createdAt)}</span>
                </div>
                <button
                  className="v2-btn v2-btn-xs"
                  onClick={async () => {
                    const response = await api.setCurrentFramework({ notebookId: selectedNotebookId, frameworkId: item.id });
                    if (!response?.success) {
                      window.alert(`切换版本失败：${response?.error || '未知错误'}`);
                      return;
                    }
                    await loadFrameworkStage(selectedNotebookId);
                    setAssistantStatus('已切换当前教学框架版本。');
                  }}
                >
                  切换
                </button>
              </div>
            )) : <p className="v2-hint">暂无框架版本</p>}
          </div>
        </div>

        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>确认稿预览</h3>
            <span className="v2-hint">默认预览当前结构化确认稿。</span>
          </div>
          <div className="v2-status-box">
            <span>阶段解锁</span>
            <strong>{pendingInfographicCount > 0 ? `还有 ${pendingInfographicCount} 个模块未确认信息图，但你仍可先确认框架。` : '模块信息图已全部确认，可以直接确认当前框架并解锁讲稿。'}</strong>
            <div className="v2-inline-actions">
              <button className="v2-btn v2-btn-primary" onClick={handleConfirmFramework}>确认当前框架并解锁讲稿</button>
            </div>
          </div>
          <div className="v2-markdown">
            {markdownBlocks.map((block, index) => {
              if (block.type === 'h1') return <h1 key={index}>{block.text}</h1>;
              if (block.type === 'h2') return <h2 key={index}>{block.text}</h2>;
              if (block.type === 'h3') return <h3 key={index}>{block.text}</h3>;
              if (block.type === 'list') return <ul key={index}>{block.items.map((item, itemIndex) => <li key={`${index}-${itemIndex}`}>{item}</li>)}</ul>;
              return <p key={index}>{block.text}</p>;
            })}
          </div>
        </div>

        <ArtifactPanel
          artifacts={artifacts}
          title="框架产物"
          hint="当前阶段写库后的结构化产物都在这里。"
          onOpenFile={(storagePath) => api.openResource(storagePath)}
          dt={dt}
        />
      </div>
    </section>
  );
}
