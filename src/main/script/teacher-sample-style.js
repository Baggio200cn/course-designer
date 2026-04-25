const TEACHER_SAMPLE_STYLE = {
  voice: [
    '开场先问候，再说明这节课带大家解决什么问题。',
    '口吻要像老师在课堂上直接说话，不写成论文或汇报稿。',
    '先讲现象，再提问题，再给判断和解释，最后回到结论。'
  ],
  pacing: [
    '按“开场导入 -> 第一/第二点 -> 总结 -> 下节预告”推进。',
    '每讲完一个点都要有停顿、回收和自然过渡。'
  ],
  interaction: [
    '常用“我向大家提个小问题”“大家想一想”“我们先看一看”“接着，说一说”带课堂。',
    '先给案例或图片，再追问学生判断、比较、选择或回忆。'
  ],
  signaturePhrases: [
    '大家好，欢迎来到今天的课堂。',
    '第一点，我们先来看。',
    '接着，我们说一说。',
    '最后，我们总结一下。'
  ],
  structure: [
    '关键结论前适合用“因此，我们发现”“所以这里要记住”。',
    '结尾要补一句“下一节课，我会带大家……”形成衔接。'
  ],
  sentenceRules: [
    '每句话只表达一个主意群，长句内部最多三处停顿。',
    '提问句尽量单独成句，便于课堂停顿和等待学生反应。',
    '少用机械模板句，多用自然转承和现场点评。'
  ],
  openingRules: [
    '开场必须包含问候、课题、本节解决什么问题、学生为什么要学。',
    '不要一上来堆定义，先让学生知道这节课的价值。'
  ],
  moduleFlow: [
    '每个模块优先按“现象/案例 -> 提问 -> 判断/解释 -> 小结”生成。',
    '不同模块要有不同推进方式，不能四个模块都套同一套句子。'
  ],
  closingRules: [
    '结尾必须回收本节内容，说明学生收获，并预告下一节课。',
    '结尾语气要收束，不要再扩写新知识。'
  ],
  forbidden: [
    '我先用一个场景带大家进去',
    '这里真正要抓住的，不是把名词背下来',
    '经常用……带课堂',
    '适合在……前加',
    '时间：',
    '教师示范',
    '板书关键词',
    '课堂检查重点'
  ]
};

function mergeTeacherSampleStyle(style = {}) {
  return {
    voice: [...(style.voice || []), ...TEACHER_SAMPLE_STYLE.voice],
    pacing: [...(style.pacing || []), ...TEACHER_SAMPLE_STYLE.pacing],
    interaction: [...(style.interaction || []), ...TEACHER_SAMPLE_STYLE.interaction],
    forbidden: [...(style.forbidden || []), ...TEACHER_SAMPLE_STYLE.forbidden],
    signaturePhrases: [...(style.signaturePhrases || []), ...TEACHER_SAMPLE_STYLE.signaturePhrases],
    structure: [...(style.structure || []), ...TEACHER_SAMPLE_STYLE.structure],
    sentenceRules: [...(style.sentenceRules || []), ...TEACHER_SAMPLE_STYLE.sentenceRules],
    openingRules: [...(style.openingRules || []), ...TEACHER_SAMPLE_STYLE.openingRules],
    moduleFlow: [...(style.moduleFlow || []), ...TEACHER_SAMPLE_STYLE.moduleFlow],
    closingRules: [...(style.closingRules || []), ...TEACHER_SAMPLE_STYLE.closingRules],
    contentDirectives: [...(style.contentDirectives || [])],
    controlHints: {
      interactionEmphasis: Boolean(style?.controlHints?.interactionEmphasis),
      discussionEmphasis: Boolean(style?.controlHints?.discussionEmphasis),
      studentOutputEmphasis: Boolean(style?.controlHints?.studentOutputEmphasis)
    }
  };
}

module.exports = {
  TEACHER_SAMPLE_STYLE,
  mergeTeacherSampleStyle
};
