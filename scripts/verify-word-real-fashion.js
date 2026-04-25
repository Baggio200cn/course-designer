const path = require('path');
const fs = require('fs');
const { exportNotebookWord } = require('../src/main/export/word');

async function run() {
  const outputPath = path.join(__dirname, '..', 'output', 'test-fashion-4h.docx');
  await exportNotebookWord({
    notebook: {
      name: '匠心于形、传播有声——服装POP海报创意设计',
      courseCode: '750105', totalHours: 4, theoryHours: 2, practiceHours: 2,
      grade: '二年级', prerequisite: '服装陈列基础',
      description: '围绕服装POP海报创意设计展开的综合实践课程。'
    },
    modules: [
      { moduleNumber: 1, name: '寻·潮起', hours: 0.5, description: '导入POP概念与案例赏析', knowledgePoints: ['POP定义', '核心功能', '国潮案例'], teachingMethods: '讲解+案例展示' },
      { moduleNumber: 2, name: '解·器用', hours: 0.75, description: '讲解设计元素与分类', knowledgePoints: ['主题', '文案', '图案', '构图'], teachingMethods: '讲解+A/B对比分析' },
      { moduleNumber: 3, name: '建立评价标准', hours: 0.25, description: '共构三力评价体系', knowledgePoints: ['视觉冲击力', '信息传达力', '艺术感染力'], teachingMethods: '师生共构+标准讲解' },
      { moduleNumber: 4, name: '创·拼图', hours: 1.2, description: '小组PBL实践设计POP海报', knowledgePoints: ['任务书解读', '纹样应用', '文案结构'], teachingMethods: 'PBL项目+小组协作+动手操作' },
      { moduleNumber: 5, name: '赏·雅集', hours: 0.8, description: '画廊漫步互评', knowledgePoints: ['互评动线', '三力标准应用', '作品评选'], teachingMethods: '画廊漫步+互评+投票' },
      { moduleNumber: 6, name: '悟·道远', hours: 0.5, description: '知识回顾与文化延伸', knowledgePoints: ['知识回顾', '三问测验', '文化传播'], teachingMethods: '回顾+测验+总结' }
    ],
    schedule: [],
    framework: {
      objectives: {
        knowledge: ['掌握POP定义与三大功能', '理解四大设计元素与六类分类', '掌握三力评价标准'],
        skills: ['能运用传统纹样和国潮色彩设计POP海报', '能运用三段式文案结构创作文案', '具备画廊漫步互评能力'],
        attitude: ['培养精益求精的工匠精神', '增强运用POP传播中国文化的使命感']
      },
      keyPoints: {
        highlights: ['POP海报的视觉传达三要素', '品牌卖点提炼方法'],
        difficulties: ['从品牌角度而非纯美术角度设计海报', '评价标准的实际运用']
      }
    },
    outputPath
  });

  const stats = fs.statSync(outputPath);
  console.log(JSON.stringify({ ok: true, file: outputPath, sizeKB: (stats.size/1024).toFixed(1) }, null, 2));
}

run().catch(e => { console.error(e); process.exit(1); });
