/**
 * V2.4 Extended I18n Configuration
 * 
 * Complete i18n coverage: all decision strings, UI labels, time formats, nutrition units
 * Supports: Chinese (zh), English (en), Japanese (ja), Korean (ko)
 */

export const EXTENDED_I18N_TRANSLATIONS = {
  zh: {
    // ===== 决策行动 =====
    'action.must_eat': '必须吃',
    'action.should_eat': '建议吃',
    'action.can_skip': '可以不吃',
    'action.should_avoid': '建议不吃',

    // ===== 营养评分 =====
    'nutrition.status.perfect': '完美',
    'nutrition.status.good': '良好',
    'nutrition.status.fair': '一般',
    'nutrition.status.poor': '较差',

    // ===== 营养问题 =====
    'issue.protein_low': '蛋白质不足',
    'issue.carbs_low': '碳水不足',
    'issue.fat_excess': '脂肪过量',
    'issue.fiber_low': '纤维不足',
    'issue.calories_excess': '热量超标',

    // ===== 时间表达 =====
    'time.now': '现在',
    'time.within_hours': '{{hours}} 小时内',
    'time.today': '今天',
    'time.tomorrow': '明天',
    'time.this_week': '本周',

    // ===== 营养单位 =====
    'unit.gram': '克',
    'unit.calorie': '卡',
    'unit.percent': '%',
    'unit.carbs': '克碳水',
    'unit.protein': '克蛋白质',
    'unit.fat': '克脂肪',

    // ===== 教练建议 =====
    'coach.title': '饮食教练',
    'coach.analysis': '分析结果',
    'coach.recommendation': '推荐',
    'coach.alternatives': '替代方案',
    'coach.confidence': '准确度',

    // ===== 决策原因维度 =====
    'reason.nutrition': '营养平衡',
    'reason.health': '健康',
    'reason.allergy': '过敏',
    'reason.preference': '个人偏好',
    'reason.timing': '进食时间',

    // ===== UI文本 =====
    'label.decision': '决策',
    'label.analysis': '分析',
    'label.nutrition': '营养',
    'label.feedback': '反馈',
    'label.history': '历史',

    // ===== 反馈表述 =====
    'feedback.accepted': '已采纳',
    'feedback.rejected': '已拒绝',
    'feedback.modified': '已修改',
  },
  en: {
    // ===== Actions =====
    'action.must_eat': 'Must eat',
    'action.should_eat': 'Should eat',
    'action.can_skip': 'Can skip',
    'action.should_avoid': 'Should avoid',

    // ===== Nutrition Status =====
    'nutrition.status.perfect': 'Perfect',
    'nutrition.status.good': 'Good',
    'nutrition.status.fair': 'Fair',
    'nutrition.status.poor': 'Poor',

    // ===== Nutrition Issues =====
    'issue.protein_low': 'Protein low',
    'issue.carbs_low': 'Carbs low',
    'issue.fat_excess': 'Fat excess',
    'issue.fiber_low': 'Fiber low',
    'issue.calories_excess': 'Calorie exceeded',

    // ===== Time Expressions =====
    'time.now': 'Now',
    'time.within_hours': 'Within {{hours}} hours',
    'time.today': 'Today',
    'time.tomorrow': 'Tomorrow',
    'time.this_week': 'This week',

    // ===== Nutrition Units =====
    'unit.gram': 'g',
    'unit.calorie': 'cal',
    'unit.percent': '%',
    'unit.carbs': 'g carbs',
    'unit.protein': 'g protein',
    'unit.fat': 'g fat',

    // ===== Coach =====
    'coach.title': 'Diet Coach',
    'coach.analysis': 'Analysis',
    'coach.recommendation': 'Recommendation',
    'coach.alternatives': 'Alternatives',
    'coach.confidence': 'Confidence',

    // ===== Decision Reason Dimensions =====
    'reason.nutrition': 'Nutrition Balance',
    'reason.health': 'Health',
    'reason.allergy': 'Allergy',
    'reason.preference': 'Personal Preference',
    'reason.timing': 'Meal Timing',

    // ===== UI Text =====
    'label.decision': 'Decision',
    'label.analysis': 'Analysis',
    'label.nutrition': 'Nutrition',
    'label.feedback': 'Feedback',
    'label.history': 'History',

    // ===== Feedback =====
    'feedback.accepted': 'Accepted',
    'feedback.rejected': 'Rejected',
    'feedback.modified': 'Modified',
  },
  ja: {
    // ===== 行動 =====
    'action.must_eat': '必ず食べるべき',
    'action.should_eat': '食べるべき',
    'action.can_skip': 'スキップ可能',
    'action.should_avoid': '避けるべき',

    // ===== 栄養状態 =====
    'nutrition.status.perfect': '完璧',
    'nutrition.status.good': '良い',
    'nutrition.status.fair': '普通',
    'nutrition.status.poor': '悪い',

    // ===== 栄養問題 =====
    'issue.protein_low': 'タンパク質不足',
    'issue.carbs_low': '炭水化物不足',
    'issue.fat_excess': '脂肪過剰',
    'issue.fiber_low': '食物繊維不足',
    'issue.calories_excess': 'カロリー超過',

    // ===== 時間表現 =====
    'time.now': '今',
    'time.within_hours': '{{hours}}時間以内',
    'time.today': '今日',
    'time.tomorrow': '明日',
    'time.this_week': '今週',

    // ===== 栄養単位 =====
    'unit.gram': 'g',
    'unit.calorie': 'cal',
    'unit.percent': '%',
    'unit.carbs': 'g炭水化物',
    'unit.protein': 'gタンパク質',
    'unit.fat': 'g脂肪',

    // ===== コーチ =====
    'coach.title': 'ダイエットコーチ',
    'coach.analysis': '分析',
    'coach.recommendation': '推奨',
    'coach.alternatives': '代替案',
    'coach.confidence': '信頼度',

    // ===== 決定理由の側面 =====
    'reason.nutrition': '栄養バランス',
    'reason.health': '健康',
    'reason.allergy': 'アレルギー',
    'reason.preference': '個人的嗜好',
    'reason.timing': '食事の時間',

    // ===== UI テキスト =====
    'label.decision': '決定',
    'label.analysis': '分析',
    'label.nutrition': '栄養',
    'label.feedback': 'フィードバック',
    'label.history': '履歴',

    // ===== フィードバック =====
    'feedback.accepted': '受け入れた',
    'feedback.rejected': '拒否',
    'feedback.modified': '修正',
  },
  ko: {
    // ===== 행동 =====
    'action.must_eat': '반드시 먹어야 함',
    'action.should_eat': '먹어야 함',
    'action.can_skip': '건너뛸 수 있음',
    'action.should_avoid': '피해야 함',

    // ===== 영양 상태 =====
    'nutrition.status.perfect': '완벽',
    'nutrition.status.good': '좋음',
    'nutrition.status.fair': '보통',
    'nutrition.status.poor': '나쁨',

    // ===== 영양 문제 =====
    'issue.protein_low': '단백질 부족',
    'issue.carbs_low': '탄수화물 부족',
    'issue.fat_excess': '지방 초과',
    'issue.fiber_low': '식이섬유 부족',
    'issue.calories_excess': '칼로리 초과',

    // ===== 시간 표현 =====
    'time.now': '지금',
    'time.within_hours': '{{hours}}시간 이내',
    'time.today': '오늘',
    'time.tomorrow': '내일',
    'time.this_week': '이번 주',

    // ===== 영양 단위 =====
    'unit.gram': 'g',
    'unit.calorie': 'kcal',
    'unit.percent': '%',
    'unit.carbs': 'g 탄수화물',
    'unit.protein': 'g 단백질',
    'unit.fat': 'g 지방',

    // ===== 코치 =====
    'coach.title': '식단 코치',
    'coach.analysis': '분석',
    'coach.recommendation': '권장',
    'coach.alternatives': '대체 옵션',
    'coach.confidence': '신뢰도',

    // ===== 결정 이유 차원 =====
    'reason.nutrition': '영양 균형',
    'reason.health': '건강',
    'reason.allergy': '알레르기',
    'reason.preference': '개인 선호도',
    'reason.timing': '식사 시간',

    // ===== UI 텍스트 =====
    'label.decision': '결정',
    'label.analysis': '분석',
    'label.nutrition': '영양',
    'label.feedback': '피드백',
    'label.history': '이력',

    // ===== 피드백 =====
    'feedback.accepted': '수락됨',
    'feedback.rejected': '거부됨',
    'feedback.modified': '수정됨',
  },
};
