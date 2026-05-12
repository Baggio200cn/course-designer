/**
 * MyWorkbench.jsx — 我的工作台（Phase-7.7 A3）
 *
 * 老师视角的课程开发统计：
 *  - 总课程数 / 各阶段完成数 / 整体完成率
 *  - 本地经验沉淀（agent_memories）展示
 *  - 历史课程列表（按更新时间倒序）
 *  - 「匿名贡献课程样本」按钮（暂 mock，未来阶段实现真上传）
 *
 * 设计原则：
 *  - 完全本地数据，不上传任何信息
 *  - 没数据时显示友好引导（"还没课程，去新建一个"）
 *  - 老师能直观看到"系统越用越懂我"的累积效果
 */

import React, { useState, useEffect } from 'react';

export default function MyWorkbench({ api, onClose, onOpenNotebook }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportingCardsId, setExportingCardsId] = useState(null);  // C4：标记当前导出中的笔记本

  // C4：导出指定笔记本的互动测试卡片
  const exportInteractiveCardsFor = async (notebookId, name) => {
    setExportingCardsId(notebookId);
    try {
      const res = await api.exportInteractiveCardsV2({ notebookId });
      if (res?.cancelled) return;
      if (!res?.success && !res?.data) {
        window.alert(`导出失败：${res?.error || '未知错误'}`);
        return;
      }
      window.alert(`✅ 互动测试卡片已导出：\n${res.data?.filePath || ''}\n\n用法：双击打开 HTML 即可在浏览器使用，可发给学生。`);
    } finally {
      setExportingCardsId(null);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api.workbenchGetStats();
        if (!mounted) return;
        if (res?.success) {
          setStats(res.data || null);
        } else {
          setError(res?.error || '加载失败');
        }
      } catch (e) {
        if (mounted) setError(e.message);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [api]);

  if (loading) {
    return (
      <div style={overlayStyle}>
        <div style={panelStyle}>
          <header style={headerStyle}>
            <h2 style={titleStyle}>📊 我的工作台</h2>
            <button onClick={onClose} style={closeBtnStyle}>✕ 关闭</button>
          </header>
          <div style={loadingStyle}>加载中…</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={overlayStyle}>
        <div style={panelStyle}>
          <header style={headerStyle}>
            <h2 style={titleStyle}>📊 我的工作台</h2>
            <button onClick={onClose} style={closeBtnStyle}>✕ 关闭</button>
          </header>
          <div style={{ ...loadingStyle, color: '#dc2626' }}>❌ 加载失败：{error}</div>
        </div>
      </div>
    );
  }

  // 数据完全没有时的友好提示
  if (!stats || stats.totalNotebooks === 0) {
    return (
      <div style={overlayStyle}>
        <div style={panelStyle}>
          <header style={headerStyle}>
            <h2 style={titleStyle}>📊 我的工作台</h2>
            <button onClick={onClose} style={closeBtnStyle}>✕ 关闭</button>
          </header>
          <div style={emptyStyle}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🌱</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 18, color: '#374151' }}>还没有课程</h3>
            <p style={{ margin: 0, color: '#6b7280' }}>
              去右上角【新建教学进度表】创建你的第一门课，<br />
              这里会记录你的开发进度和经验沉淀。
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        <header style={headerStyle}>
          <h2 style={titleStyle}>📊 我的工作台</h2>
          <button onClick={onClose} style={closeBtnStyle}>✕ 关闭</button>
        </header>

        <div style={contentStyle}>
          {/* 工作台说明（Phase-9 补） */}
          <section style={{ ...sectionStyle, background: '#fffbea', border: '1px solid #fde68a', borderRadius: 8, padding: 16 }}>
            <h3 style={{ ...sectionTitleStyle, color: '#92400e' }}>这个工作台帮你做什么</h3>
            <ol style={{ margin: '8px 0 0 20px', padding: 0, color: '#92400e', fontSize: 14, lineHeight: 1.7 }}>
              <li><strong>跨课程总览</strong>：你开发了几门课、每门课走到哪一步，一眼看完——不用一个个点进笔记本</li>
              <li><strong>经验沉淀</strong>：每次确认教学设计 / 讲稿 / PPT 时，系统把这门课的"做对的部分"存到本地。下次做相似主题时，AI 会自动参考你之前的成功案例（不上传任何信息）</li>
              <li><strong>批量导出</strong>：单课程一键导出互动测试卡片 HTML（学生端可用）</li>
            </ol>
            <p style={{ margin: '8px 0 0', color: '#92400e', fontSize: 13 }}>
              💡 <strong>什么时候用</strong>：你不知道哪门课没做完时，或想看历史课程对比时，进来看一眼即可。日常工作流不必经过这里。
            </p>
          </section>

          {/* 统计卡片（Phase-9：更新为 6 阶段） */}
          <section style={sectionStyle}>
            <h3 style={sectionTitleStyle}>课程开发概览（6 阶段）</h3>
            <div style={kpiGridStyle}>
              <KpiCard label="总课程数" value={stats.totalNotebooks} accent="#2563eb" />
              <KpiCard label="教学设计已确认" value={`${stats.confirmedFrameworks ?? 0} / ${stats.totalNotebooks}`} accent="#16a34a" />
              <KpiCard label="讲稿已确认" value={`${stats.confirmedLectures ?? 0} / ${stats.totalNotebooks}`} accent="#16a34a" />
              <KpiCard label="PPT 已确认" value={`${stats.confirmedPpts ?? 0} / ${stats.totalNotebooks}`} accent="#16a34a" />
              <KpiCard label="整体完成率" value={`${stats.overallCompletionRate}%`} accent="#7c3aed" />
              <KpiCard label="平均迭代次数" value={stats.avgRegenerations} accent="#ea580c" />
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 12, color: '#9ca3af' }}>
              注：v4.0.0 的"教学进度表 / 微课视频 / 实施报告"统计字段尚未接入工作台，下个版本补。
            </p>
          </section>

          {/* 经验沉淀 */}
          <section style={sectionStyle}>
            <h3 style={sectionTitleStyle}>
              🧠 本地经验沉淀
              <span style={subTitleStyle}>（系统会用历史成功案例帮你做下次生成参考——完全本地，不上传）</span>
            </h3>
            {stats.totalMemories === 0 ? (
              <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>
                还没有经验沉淀。<strong>每次手动确认教学设计 / 讲稿 / PPT 时</strong>，系统会自动累积这门课的成功经验，
                下次开发相似主题课程时自动作为参考样本注入 AI。
              </p>
            ) : (
              <>
                <p style={{ margin: '0 0 12px', color: '#16a34a', fontSize: 14 }}>
                  ✅ 已累积 <strong>{stats.totalMemories}</strong> 条课程经验，下次相似主题课程会自动用这些做参考。
                </p>
                <div style={memListStyle}>
                  {(stats.memories || []).map((mem, i) => (
                    <div key={mem.id || i} style={memItemStyle}>
                      <div style={memTitleStyle}>📘 {mem.courseName || '未命名'}</div>
                      <div style={memMetaStyle}>
                        {mem.totalHours ? `${mem.totalHours} 学时 · ` : ''}
                        关键词 {mem.keywords?.length || 0} 个 ·
                        讲稿 {mem.lectureCharCount || 0} 字
                      </div>
                      {mem.frameworkObjectives && (
                        <div style={memSummaryStyle}>{String(mem.frameworkObjectives).slice(0, 100)}…</div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* 历史课程 */}
          <section style={sectionStyle}>
            <h3 style={sectionTitleStyle}>
              📚 我的课程（最近 30 个，按更新时间倒序）
              <span style={subTitleStyle}>（点击课程名打开 / 点 🎮 一键导出该课程的互动测试卡片）</span>
            </h3>
            <div style={courseListStyle}>
              {(stats.recentActivities || []).map((c) => (
                <div key={c.notebookId} style={courseItemStyle}>
                  <div
                    style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                    onClick={() => onOpenNotebook?.(c.notebookId)}
                    title="点击打开此课程"
                  >
                    <div style={courseNameStyle}>{c.name}</div>
                    <div style={courseMetaStyle}>
                      {c.totalHours} 学时 · {c.updatedAt ? new Date(c.updatedAt).toLocaleString('zh-CN') : '未知时间'}
                    </div>
                  </div>
                  <div style={stageDotsStyle}>
                    {/* Phase-9：6 阶段 dots（schedule/design 字段后端尚未上报，先显示已有 3 个）*/}
                    <StageDot label="设计" done={c.stages.framework} />
                    <StageDot label="讲稿" done={c.stages.lecture} />
                    <StageDot label="PPT" done={c.stages.ppt} />
                    {c.memorySaved && <span title="已沉淀经验" style={{ marginLeft: 6 }}>🧠</span>}
                  </div>
                  {/* C4：单课程一键导出互动测试卡片（仅 framework 已确认时显示）*/}
                  {c.stages.framework && (
                    <button
                      style={{
                        ...exportCardsBtnStyle,
                        opacity: exportingCardsId === c.notebookId ? 0.6 : 1,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        exportInteractiveCardsFor(c.notebookId, c.name);
                      }}
                      disabled={exportingCardsId === c.notebookId}
                      title="导出此课程的互动测试卡片 HTML（学生端）"
                    >
                      {exportingCardsId === c.notebookId ? '⏳' : '🎮'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* 互动测试卡片说明 */}
          <section style={sectionStyle}>
            <h3 style={sectionTitleStyle}>🎮 关于互动测试卡片</h3>
            <p style={{ margin: 0, color: '#374151', fontSize: 13, lineHeight: 1.7 }}>
              互动测试卡片是基于课程框架自动生成的<strong>学生端 HTML 文件</strong>，含：
              <br/>① 翻卡（点击查看详情）　② "我学会了"标记（LocalStorage 持久化）
              <br/>③ 每模块自检小测（多选题 + 自评）　④ 顶部进度条 + 全部学完触发庆祝动画
              <br/><br/>
              <strong>使用场景</strong>：
              <br/>📺 课堂大屏展示带学生互动
              <br/>📱 课后发文件/链接给学生自学
              <br/>📊 学生进度本地保存，下次打开继续
              <br/><br/>
              <strong>导出方法</strong>：上方课程列表里 framework 已确认（✓）的课程，点 🎮 按钮直接导出。
            </p>
          </section>

          {/* 匿名贡献入口（mock，留 hook 给未来上线） */}
          <section style={sectionStyle}>
            <h3 style={sectionTitleStyle}>📤 帮助系统改进（可选）</h3>
            <p style={{ margin: '0 0 12px', color: '#6b7280', fontSize: 14, lineHeight: 1.6 }}>
              如果你愿意，可以匿名贡献本课程样本帮助系统改进 prompt 命中率——<strong>所有学校/老师/学生信息都会脱敏</strong>，
              只保留行业类型、模块结构、AI 生成 vs 老师修改的差异。当前版本暂未开通真实上传通道，
              开发者会通过版本更新优化 prompt。
            </p>
            <button
              style={{ ...btnStyle, opacity: 0.5, cursor: 'not-allowed' }}
              disabled
              title="该功能将在后续版本开通真实上传"
            >
              📤 匿名贡献当前课程（即将开通）
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── 子组件 ────────────────────────────────────────────────
function KpiCard({ label, value, accent }) {
  return (
    <div style={{ ...kpiCardStyle, borderLeftColor: accent }}>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent }}>{value}</div>
    </div>
  );
}

function StageDot({ label, done }) {
  return (
    <span style={{
      ...stageDotStyle,
      background: done ? '#16a34a' : '#e5e7eb',
      color: done ? '#fff' : '#6b7280',
    }}>
      {done ? '✓' : '○'} {label}
    </span>
  );
}

// ─── 样式 ──────────────────────────────────────────────────
const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000, padding: 20,
};
const panelStyle = {
  background: '#fff', borderRadius: 12, width: '100%', maxWidth: 980,
  maxHeight: '92vh', display: 'flex', flexDirection: 'column',
  boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
};
const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '16px 24px', borderBottom: '1px solid #e5e7eb',
};
const titleStyle = { margin: 0, fontSize: 18, color: '#111' };
const closeBtnStyle = {
  border: '1px solid #d1d5db', background: '#fff', padding: '6px 12px',
  borderRadius: 6, cursor: 'pointer', fontSize: 13,
};
const contentStyle = { padding: '20px 24px', overflowY: 'auto', flex: 1 };
const sectionStyle = { marginBottom: 28 };
const sectionTitleStyle = {
  fontSize: 14, fontWeight: 600, color: '#374151',
  margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8,
};
const subTitleStyle = { fontSize: 12, fontWeight: 'normal', color: '#9ca3af' };
const loadingStyle = {
  padding: 60, textAlign: 'center', color: '#6b7280', fontSize: 14,
};
const emptyStyle = {
  padding: 60, textAlign: 'center',
};
const kpiGridStyle = {
  display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
};
const kpiCardStyle = {
  background: '#f9fafb', padding: '14px 16px',
  borderRadius: 8, borderLeft: '4px solid',
};
const memListStyle = {
  display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10,
};
const memItemStyle = {
  background: '#f0fdf4', border: '1px solid #bbf7d0',
  padding: '10px 12px', borderRadius: 6,
};
const memTitleStyle = { fontSize: 13, fontWeight: 600, color: '#065f46', marginBottom: 4 };
const memMetaStyle = { fontSize: 11, color: '#6b7280', marginBottom: 4 };
const memSummaryStyle = { fontSize: 12, color: '#374151', lineHeight: 1.4 };
const courseListStyle = {
  display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto',
};
const courseItemStyle = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '10px 12px', background: '#f9fafb', borderRadius: 6,
  cursor: 'pointer', transition: 'background 0.15s',
};
const courseNameStyle = { fontSize: 14, fontWeight: 500, color: '#111', marginBottom: 2 };
const courseMetaStyle = { fontSize: 11, color: '#6b7280' };
const stageDotsStyle = { display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 };
const stageDotStyle = {
  fontSize: 11, padding: '3px 8px', borderRadius: 10, fontWeight: 500,
  whiteSpace: 'nowrap',
};
const btnStyle = {
  border: '1px solid #d1d5db', background: '#fff',
  padding: '8px 16px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
};
const exportCardsBtnStyle = {
  background: '#7c3aed', color: '#fff', border: 'none',
  padding: '6px 10px', borderRadius: 6, fontSize: 14, cursor: 'pointer',
  marginLeft: 8, flexShrink: 0,
  transition: 'opacity 0.15s',
};
