"""Generate the RhythmDesk developer handoff document (1.59 -> 1.60 -> 1.61).

Usage: python3 make_handoff.py V159_DIR … V166_DIR OUT.txt  (eight version folders, oldest first)
  each Vxxx_DIR holds RhythmDesk-Win11/ (the Win11 package) and index.html (the Android page)

Every before/after code block is taken from the real files: the edit lists of patch160.py and
patch161.py … patch166.py give the changed passages; their line numbers are looked up in the version before and
after the round. Changes outside the patch lists (version strings, readmes, tests, iPhone files)
are listed from a line diff.
"""
import difflib
import re
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
import patch160  # noqa: E402
import patch161  # noqa: E402
import patch162  # noqa: E402
import patch163  # noqa: E402
import patch164  # noqa: E402
import patch165  # noqa: E402
import patch166  # noqa: E402

V159, V160, V161, V162, V163, V164, V165, V166, OUT = (Path(arg) for arg in sys.argv[1:10])
RULE = '-' * 78
HEAVY = '=' * 78
UI = 'RhythmDesk-Win11/source/ui/'

PROMPT_1 = ('@"RhythmDesk.zip" 该压缩包内有两个平台的软件版本，一个是win11版，一个是安卓版，其中安卓版的签名文件也已经在压缩包中，'
            '请按照要求修改基础操作功能，并同步到这两个平台的后续版本中，优化：在乐器轨道菜单里加入复制本轨道选项，复制内容为包括音符在内的'
            '所有内容，编辑乐谱时，切分按钮不需要清除音符再修改，可以在写入音符状态下直接修改，所有需要双击激活的菜单控制栏也可以同时使用长按'
            '激活，长按激活的时长是1秒，激活后的菜单要避开长按位置防止错按选项')
PROMPT_2 = ('在进行一次优化，此次优化内容如下：1. 在循环区间添加，点击方块向后继续播放时，再次循环几次的按钮功能。'
            '2. 播放时所有轨道都要显示音符播放的位置，显示方式改成一个蓝色方块阔到音符上面。'
            '3. 在编辑菜单音符按钮位置，可以选择长按该音符按钮，切换为锁定该音符点按进行谱子输入该音符模式。'
            '4.此次优化后，将所有优化内容整理汇总成一个文本文档作为交接给其他程序开发人员使用的参考，交接内容为从你初次接手该软件优化到这次'
            '优化为止的所有优化提示词汇总及每段提示词你都做了何种程序修改，要列出修改前那段位置的源程序及修改过后同样位置的程序代码对比。')

SUMMARY_1 = {
    'dup': """在轨道标题「⋯」菜单的「↓ 下移轨道」之后加入「复制本轨道」。
  · model.js 新增 duplicateTrack(doc, track, name)：structuredClone 整条轨道（音符 cells、左右手 hands、
    measures 小节／拍号／切分、tempoRatio 速度、loops 循环、lineBreaks 换行、samples 自定义音色、preset、
    音量／声像／静音／独奏），分配新的唯一 id（t1、t2…），名称加「副本」（重名时加序号「副本 2」…，28 字以内），
    插入到原轨道下方；若原轨道属于 Bell+Drum 配对组，则插入到整个配对组下方。复制出来的 Bell 设为
    bellFor = null（不与任何鼓配对），原配对保持不变。
  · app.js 新增 duplicateTrackWithContent(source)：检查 100 条轨道上限和 640 KiB 采样上限（超出则提示），
    通过 change(...) 执行（可一次撤销），光标移到副本同一位置并滚动显示，状态栏提示。
  · app.js 新增 duplicateTrackName(name)：生成「原名 副本」/「原名 副本 2」…。
  · i18n.js 新增 track.duplicate / track.copySuffix / track.duplicated / track.duplicateLimit /
    track.duplicateBudget（中英文）；说明书「轨道标题「⋯」」条目补充说明。""",
    'split': """切分（♫ 键、数字键 1–4、拍菜单「拆分为…」「切换 3/4 细分」）在已写入音符时直接修改，不再要求先清空。
  · app.js 删除 blockSubdivisionChange()（原先发现蓝框内有音符就弹出「请先清空蓝框内的音符，再更换切分小拍」），
    并去掉 changeTuplet / openSplitMenu / splitBeat 中对它的调用。
  · model.js splitTrackBeat()：被切分的那一格内，旧子格 i 映射到新子格 round(i × 新份数 / 旧份数)，
    其他格位置不变；只有两个音符落到同一格时才计为「重叠」（dropped），由调用方确认后合并。
    原先的规则是「不在新格位上的音符直接删除」。
  · 同时放宽了同类的批量细分（超出提示词字面范围、属于同一类操作）：applyBeatSizes（整谱「所有拍组改为 3/4 细分」）
    去掉「请先清空受影响小节」的拦截；openBulkSplit（小节／轨道／整谱「统一拆分」）去掉「请先清空所选范围」的拦截；
    model.js splitTrackRange() 不再抛错，改为返回 {track, merged}，重叠数交给 confirmBeatSizes 确认。
  · i18n.js 删除不再使用的 bulk.clearFirst / beat.clearBeforeSplit / beat.clearBeforeBulkSplit，
    beat.confirmSplitMerge 改为「重叠并被合并」的说法；说明书相应条目更新。拍号更换（meter）的「先清空」规则未改。""",
    'hold': """所有需要双击打开的菜单同时支持按住 1 秒打开（手指、触控笔、鼠标左键均可），菜单避开按压位置。
  · 适用控件：符杆（拍菜单）、符杆上方蓝点（左右手菜单）、小节线（小节菜单）、组拍号（拍号菜单）、组速度（速度弹窗）。
  · app.js 新增 bindMenuHold(node, open, allowed)：pointerdown 起计时 1000 ms；移动超过 10 px、第二根手指按下、
    pointerup/pointercancel、滚轮、窗口失焦都会取消；触发时记录按压点 menuHoldPoint；松手后 400 ms 内的 click 被吞掉，
    所以抬手不会点中菜单项，也不会触发原控件的单击；同时阻止这些控件的系统 contextmenu。
  · app.js 新增 clearOfMenuHold(box, bounds)：若菜单矩形（外扩 40 px）覆盖按压点，依次尝试放到按压点上方、下方、
    右侧、左侧及四个斜角；都放不下时选重叠最少的位置并标记 covered。新增 menuHoldRoom(bounds)。
  · positionPopup()（小节线／拍号／左右手菜单）：covered 时把可滚动菜单的 max-height 缩到按压点上下较大一侧的空间。
    positionBeatMenu()（拍菜单）：移动后加 clear-of-hold 类以隐藏指向箭头。openTempoEditor()（速度弹窗）：打开后若遮挡按压点则改为固定定位移开。
  · 多选模式下符杆保持原来的 0.5 秒长按选整组规则，不触发 1 秒菜单。
  · style.css：这些控件禁止文字选择和系统长按菜单；.beat-menu.clear-of-hold::after 隐藏箭头。
  · 开发中的调整：① 菜单尺寸为整数像素，摆放时多留 2 px 余量；② 手机上很长的小节线菜单上下都放不下时缩短并可滚动；
    ③ 去掉「滚动即取消长按」，因为播放跟随会滚动谱面，导致鼠标长按在 0.9 秒后被打断（只保留滚轮取消）。""",
    'common': """关于页「本版更新」文字（help.aboutUpdate）描述本轮三项改动。""",
}
PROMPT_3 = ('功能完善的很好，有3个小修改：1.循环次数可以自由填写，不用设定成固定次数。2.核对修改后的说明文件，有不同同步更新。'
            '3.播放时跟随显示的蓝色方框要竖的长方形，覆盖住竖线部分')

PROMPT_4 = ('循环设定可以在每个循环区域预设，如同一轨道出现多个循环，则可以在每个循环预设循环次数自动向后播放，'
            '所有长按激活的菜单长按激活时长改成0.5秒，另外双击激活的模式弹出菜单也要让开点击位置避免误点，同步说明书修正及延续交接内容')

PROMPT_5 = '多选模式下，单个点选音符竖线的蓝色选框要改成半透明，可以看到竖线及音符的谱面状态'

PROMPT_6 = '所有长按激活菜单激活时间改为长按0.2秒激活'

PROMPT_7 = '所有长按激活菜单激活时间改为长按0.1秒激活，同时音符锁定也改成0.1秒激活'

SUMMARY_7 = {
    'hold': """所有长按打开的菜单改为长按 0.1 秒即打开（1.65 为 0.2 秒）。
  · app.js：MENU_HOLD_MS 由 200 改为 100（谱面五类菜单）；首页鼓谱卡片菜单 LONG_PRESS_MS 由 200 改为 100。
  · 1.65 中「已锁定音符时长按符杆打开拍菜单保留 0.5 秒」用的是 NOTE_LOCK_HOLD_MS，随需求 2 一起变为 0.1 秒，
    因此所有菜单（包括锁定状态下的拍菜单）都是 0.1 秒。bindMenuHold() 的按控件设定时长的机制保留，便于以后单独调整。
  · 影响：按住超过 0.1 秒即算长按，单击符杆、点音符键都需要轻点；说明书中加了「请轻点」的提示。
  · 多选模式里长按选整组（0.5 秒）是选择操作而非菜单，未改。
  · i18n.js 与中英文说明书中菜单的「0.2 秒」全部改为「0.1 秒」。""",
    'lock': """长按音符键（或「休止」）锁定改为 0.1 秒（1.63–1.65 为 0.5 秒，1.61–1.62 为 1 秒）。
  · app.js：NOTE_LOCK_HOLD_MS 由 500 改为 100（同时用于音符键锁定和锁定状态下符杆的拍菜单）。
  · i18n.js keys.lockHint 与中英文说明书改为 0.1 秒，删去 1.65 写的「比菜单长，避免误锁」的说明，改为「输入音符时请轻点」。
  · 测试：editor165.e2e.cjs 按 1.66 改写（常量均为 100；轻点符杆只选中、轻点音符键写入并前进、按住 0.3 秒锁定且不写入；
    锁定时轻点符杆写入、按住 0.3 秒打开拍菜单；首页卡片按住 0.3 秒打开菜单、轻点打开鼓谱）；editor160／editor163 中
    「短按不应打开」改为 0.02 秒。""",
    'common': """关于页「本版更新」文字按 1.66 改写；Readme.txt 与 source/Readme-Win11.txt 首行改为 1.66 并新增「1.66 更新」；
  仓库 README.md 增加 1.66 段落；本交接文档延续加入第 7 段提示词与修改对照，并更新版本记录、构建与测试命令。""",
}

SUMMARY_6 = {
    'hold': """所有长按打开的菜单改为长按 0.2 秒即打开（1.63–1.64 为 0.5 秒，1.60–1.62 为 1 秒）。
  · 谱面菜单（符杆拍菜单、蓝点左右手菜单、小节线菜单、组拍号菜单、组速度弹窗）：app.js MENU_HOLD_MS 由 500 改为 200。
  · 首页鼓谱卡片的长按菜单（重命名、分享、复制、删除）也是长按菜单，原来用独立常量 LONG_PRESS_MS = 500，一并改为 200。
  · 有意保留 0.5 秒的两处（新增常量 NOTE_LOCK_HOLD_MS = 500）：
    ① 长按音符键锁定（不是菜单）：平时点音符键常会按住 0.2 秒左右，若锁定也是 0.2 秒，正常输入音符时会频繁误锁。
    ② 已锁定音符时长按符杆打开拍菜单：锁定模式靠点按符杆连续输入，0.2 秒会让稍慢的点按变成打开菜单而不写入音符。
    为此 bindMenuHold() 增加第 4 个参数 delay（毫秒数，或按 pointerdown 事件返回毫秒数的函数）；符杆传入
    「锁定且不是蓝点时 0.5 秒，否则 0.2 秒」，音符键传入 0.5 秒。
  · 多选模式里长按选整组（0.5 秒）是选择操作，不是菜单，未改。
  · i18n.js 与中英文说明书中菜单的「长按 0.5 秒」改为「长按 0.2 秒」，首页卡片说明写明 0.2 秒；音符锁定与锁定时符杆的 0.5 秒
    保留并在说明书中注明原因。
  · 测试：editor160／editor163 中「短按不应打开」改为 0.08 秒（0.25／0.3 秒现在会打开）；新增 editor165.e2e.cjs 验证菜单
    0.08 秒不开、0.3 秒打开（小节线、符杆、首页卡片），音符键 0.3 秒正常写入并前进、0.65 秒锁定，锁定时 0.3 秒点符杆写入音符
    而不开菜单、0.65 秒才打开拍菜单。""",
    'common': """关于页「本版更新」文字按 1.65 改写；Readme.txt 与 source/Readme-Win11.txt 首行改为 1.65 并新增「1.65 更新」；
  仓库 README.md 增加 1.65 段落；本交接文档延续加入第 6 段提示词与修改对照，并更新版本记录、构建与测试命令。""",
}

SUMMARY_5 = {
    'pick': """多选模式中单个点选的符杆，蓝色选框改为半透明，透过选框能看到竖线和音符。
  · 原因：符杆按钮（.slot）叠在谱面图形（SVG）的上层，1.59 起单选样式 .multi-groups .slot.slot-picked 使用不透明底色 #dcecff，
    把下面的竖线、横梁和音头整个盖住；整组选中用的是拍组 .beat 的底色（在图形下层），不受影响。
  · style.css：.slot-picked 底色改为半透明蓝 #2876e829（约 16% 不透明度），边框改为半透明 #1d5b99b3（约 70%）。
  · 同一图层的多选粘贴覆盖预览 .slot.paste-preview 也有同样问题（盖住将被覆盖的原有音符），一并改为半透明
    （底色 #2876e824，上下边线 #2469bdb3）。这一项超出提示词字面范围，属同类问题。
  · 说明书（中英文）多选与粘贴两条补充说明。
  · 验证：新增测试 editor164.e2e.cjs 截图统计符杆区域内的深色像素（竖线、横梁、音头），选中前后基本相同（117→116）；
    用 1.63 页面对照时选中后为 0，说明测试确实能发现原问题。""",
    'common': """关于页「本版更新」文字按 1.64 改写；Readme.txt 与 source/Readme-Win11.txt 首行改为 1.64 并新增「1.64 更新」；
  仓库 README.md 增加 1.64 段落；本交接文档延续加入第 5 段提示词与修改对照，并更新版本记录、构建与测试命令。""",
}

SUMMARY_4 = {
    'preset': """每个循环区间可以预设循环次数，播放到该循环时播完预设遍数便自动向后播放；同一轨道的多个循环各自设定。
  · 次数的含义：该循环一共播放几遍（含第一遍，1–999）。不设次数（留空）＝与以前一样一直循环，直到按方块。
  · 数据：track.loops 的每一项可带 times 字段（如 {from: 0, to: 1, times: 3}），随 .rhythm.json 保存。model.js 新增常量
    LOOP_TIMES_MAX = 999；readLoops() 读取并校验 times（非 1–999 的整数一律忽略，视为一直循环）。旧版本软件读取新文件时
    会忽略 times（只读 from/to），即退回一直循环，不会报错。
  · 编辑小节时保留次数：deleteBar() 的 afterRemoval、insertTrackBarAt()（在第 1 小节前插入）、deleteTrackBar() 原来重建
    循环对象时只复制 from/to，改为 {...range, from, to}，避免插入／删除小节后丢失次数（shiftTrackLoopsAfterInsert 原地修改，无需改）。
  · 播放引擎（audio.js）：start() 把 times 一并传入 PlaybackCursor；restart() 创建 gate 时，有预设次数的循环直接
    released = true、repeats = times − 1，于是播完 times 遍自动继续。整曲循环（wrap）重新开始时会再次按预设执行。
    方块上方的「↻ 再循环…」和方块按钮仍可在本次播放中改写或取消（取消继续＝一直循环），不修改预设本身。
  · 界面（app.js）：小节边界菜单在「更改此循环终点」之后新增「设置结束于此的循环次数…（当前状态）」和
    「设置起始于此的循环次数…（当前状态）」；轨道「⋯」在「移除本小节的循环」之后新增「设置本小节循环次数…（当前状态）」。
    新增 loopTimesState()、openLoopTimesDialog()（与速度弹窗同样式：数字输入 1–999、−／＋、完成／取消、
    已设次数时显示「一直循环（清除次数）」；留空确认＝清除）、setLoopTimes()（按 id 与 from/to 找回当前循环，
    通过 change(…, true) 修改，可撤销，修改时停止播放，与其他循环编辑一致）。
  · 谱面标记：boundaryAt() 在设有次数的循环结束竖线左上方显示「×N」（.loop-times，17 px 粗体蓝字，随谱面缩放），
    并在该竖线的提示文字中加上「共 N 遍」。
  · i18n.js 新增 loop.timesIncoming / loop.timesOutgoing / track.loopTimes / loop.timesState / loop.timesUnset / loop.bars /
    loop.timesTitle / loop.timesHint / loop.timesClear / loop.timesSet / loop.timesCleared（中英文）；说明书「轨道循环与整曲循环」
    和「回到开头／播放／停止方块」条目补充说明。""",
    'hold': """所有长按激活改为 0.5 秒（原 1 秒）。
  · app.js：MENU_HOLD_MS 由 1000 改为 500。它同时用于五类菜单（符杆拍菜单、蓝点左右手菜单、小节线菜单、组拍号菜单、组速度弹窗）
    和 1.61 的音符键锁定，所以锁定音符也改为长按 0.5 秒（保持所有长按手感一致）。多选模式原有的 0.5 秒长按选整组、首页卡片
    0.5 秒长按菜单本来就是 0.5 秒，未改。
  · i18n.js 与中英文说明书中所有「长按 1 秒」改为「长按 0.5 秒」（meter.groupButton、bar.pickEnd、keys.lockHint 及说明书 7 处）；
    音频导出时长「1 秒至 30 分钟」与长按无关，未改。""",
    'avoid': """双击打开的弹出菜单（以及速度弹窗）也避开点按位置，避免误点。
  · 原来只有长按会记录按压点（menuHoldPoint）。现在新增 setMenuAvoidPoint(node, x, y, id)：同时记录屏幕坐标和该点在控件上的
    相对位置（fx, fy）；新增 markMenuTap(event)：在完成双击的那次 click 中调用（键盘触发的 click 没有坐标，detail 为 0，跳过）；
    新增 menuAvoidPoint()：手指仍按着时用屏幕坐标，抬起后用控件当前位置换算，使避让点跟随谱面滚动。
  · 五处双击入口（小节线、符杆拍菜单、蓝点左右手菜单、组拍号、组速度）在打开菜单前调用 markMenuTap(event)。
  · clearOfMenuHold() 与 menuHoldRoom() 改为读取 menuAvoidPoint()。按压点在下一次按下（任何 pointerdown）时清除；
    长按松手时不再清除，而是转为跟随控件的相对位置。
  · 判断与摆放增加 2 px 容差（判断 42 px、摆放 44 px）：开发中发现鼠标事件坐标取整数，菜单被屏幕底边夹住时实际距离只有 39.25 px。
  · 速度弹窗的避让注释由「一秒长按」改为「长按或双击」。说明书相应句子改为「无论双击还是长按，弹出的菜单都会避开点按位置」。""",
    'common': """说明书同步修正：除上面各需求中列出的说明书与提示文字修改外，关于页「本版更新」文字（help.aboutUpdate）按 1.63 改写；
  Readme.txt 与 source/Readme-Win11.txt 首行版本改为 1.63 并新增「1.63 更新」；仓库 README.md 重写为 1.60–1.63 的完整说明
  （补上 1.62 时漏写的段落，并把 1.60/1.61 中已被后续版本改变的描述注明当前做法，如长按时长、再循环次数、播放方框形状）；
  本交接文档延续加入第 4 段提示词与全部修改对照，并更新版本记录、构建与测试命令。""",
}

SUMMARY_3 = {
    'count': """循环次数改为自由填写，取代 1.61 的固定 1–8 次菜单。
  · app.js：openLoopRepeatMenu（1–8 次菜单）替换为 openLoopRepeatDialog()。点「↻ 再循环…」打开与速度弹窗同样式的对话框：
    数字输入框（1–999；默认显示当前剩余次数，没有待执行的继续时为 1；打开后全选，便于直接输入），−／＋ 微调，
    「完成」或回车确认，「取消」不作改动；已设定继续时多出「取消继续，保持循环」。非整数、小于 1 或大于 999 时提示并保持弹窗。
    新增常量 LOOP_REPEAT_MAX = 999。弹窗打开期间播放继续进行。
  · changeLoopRelease()：若弹窗打开期间循环已经结束，提示「循环已经结束，未作更改」。refreshControls()：循环结束或暂停时自动关闭次数弹窗。
  · 去掉 1.61 为弹出菜单加的 transport-menu 相关代码（closePopups、谱面滚动处理、refreshControls 三处），因为不再使用弹出菜单。
  · 修复 1.61 遗留问题：方块上方按钮和停止按钮提示里的剩余次数不会逐次递减。原因是循环状态对象在调度时原地 repeats--，
    回调里用同一批对象重新计算「旧状态」，与新状态永远相同，所以不刷新。新增 playingLoopState 保存上次显示的状态串并用它比较，
    stopPlayback() 时清空；测试 playback162.cjs 的沙箱同步预置 playingLoopState。
  · i18n.js：删除 loop.repeatTimes，新增 loop.repeatTitle / loop.repeatHint / loop.repeatGone（中英文）；style.css 新增
    .loop-repeat-hint、.loop-keep；说明书两处「1–8 次」改为自由输入的说明。""",
    'docs': """核对修改后的说明文件（中英文说明书、关于页、Readme、仓库 README、本交接文档），不一致处同步更新：
  · 说明书与关于页中「再循环 1–8 次」「蓝色方框」的描述按 1.62 行为改写（见需求 1、需求 3 的修改）。
  · 选中框与播放框都是蓝色，容易混淆：说明书中指选中框的「蓝框」改称「蓝色选框」（回到开头、跟随按钮两处）。
  · 英文说明书「Score and group meters」补上中文版已有的规定：更换组拍号前需先清空该组音符（软件行为未变，原英文漏写）。
  · Readme.txt 与 source/Readme-Win11.txt 首行版本改为 1.62 并新增「1.62 更新」；本交接文档加入第 3 段提示词与全部修改对照，
    并更新版本记录、构建与测试命令。（仓库 README.md 的 1.62 段落本应同时加入，但当时的更新命令因前一步比对失败而未执行，
    1.63 时发现并补上，见第 4 段提示词的需求 4。）
  · 其余说明（复制本轨道、带音符切分、长按 1 秒菜单、音符锁定、再循环的边界规则）已逐条对照软件行为，无需改动。""",
    'box': """播放位置标记由 1.61 的 28×28 px 方框改为竖向长方框，覆盖整根符杆和音头。
  · style.css .slot.playing::after：top 19%、bottom 5%（从横梁处到音头下方，约 45 px 高），宽 22 px（切分很密时不超过格宽 + 4 px），
    3 px 蓝色边框、半透明蓝底、圆角 5 px，水平中心对齐符杆（--stem-offset）；休止处同样罩住该位置的竖线。方框随谱面缩放。
  · 说明书「播放位置」条目改为竖向长方框的描述。""",
    'common': """关于页「本版更新」文字（help.aboutUpdate）按 1.62 改写。""",
}

SUMMARY_2 = {
    'repeat': """循环区间播放时，停止方块上方出现「↻ 再循环…」按钮，可选择再循环 1–8 次后自动向后继续。
  · audio.js 新增 gateLoopsBack(gate)：循环终点在「未释放」或「已释放但仍有剩余次数 repeats > 0」时回到起点。
    PlaybackCursor 的每个 gate 增加 repeats 字段；take() 在已释放的 gate 回环时 repeats--；waitingAtBoundary、
    playheadGroupMotion().loopEnd、playheadMotion() 改用 gateLoopsBack。
  · audio.js releaseLoop(repeats = 0)：释放当前循环并设定额外次数（方块按钮仍是 0 = 播完本轮继续）；
    新增 keepLooping()：撤回待执行的「继续」，恢复一直循环。
  · app.js：引擎回调的循环状态串加入 repeats（剩余次数变化时刷新按钮）；refreshControls() 计算剩余次数，
    停止按钮提示改为「将再循环 N 次后继续播放」，并显示／隐藏、定位 #loopRepeat 按钮（文字「↻ 再循环…」或「↻ 再循环 N 次」）；
    followLimit() 改用 gateLoopsBack（跟随镜头把仍会回环的终点当作边界）。
  · app.js 新增 openLoopRepeatMenu(anchor)（菜单：再循环 1–8 次后继续、取消继续保持循环）和 changeLoopRelease(times)
    （调用引擎、重算跟随镜头、提示）；该菜单带 transport-menu 类，播放跟随滚动谱面时不会被关闭；循环结束时自动关闭。
  · index.html 在 #stop 后加入 #loopRepeat 按钮；style.css 让 .transport-inner 相对定位并定义按钮样式（剩余次数时为蓝底）。
  · 边界规则与方块按钮一致：在一轮的最后约 0.12 秒内（调度器已提交回环）做选择，从下一轮开始计数。""",
    'playing': """播放时每条轨道都用蓝色方框框住正在播放的音符（休止处框住该位置）。
  · 播放位置原本由 paintPlaySteps() 给每条轨道当前格加 .playing 类（各轨道本来就都有标记，但只是一条 2 px 细竖线）。
  · style.css：.slot.playing::after 由 2 px 竖线改为 28×28 px 方框（3 px 蓝色边框、半透明蓝底、圆角），
    垂直位置对准音符头（top: calc(72% - 14px)），切分很密时宽度不超过该格宽度 + 6 px。方框随谱面缩放。
  · 暂停时方框保留，停止后清除（沿用原逻辑）。说明书新增「播放位置」条目。""",
    'lock': """长按音符键（或「休止」）1 秒锁定该键，之后点按谱面符杆即在该位置输入该音符。
  · app.js 新增状态 noteLock = {stroke, type}（stroke 为 null 表示锁定「休止」）。
  · updateKeyboard()：鼓音键和「休止」键改用 lockableKey(...) 生成（data-stroke 标记、提示文字、bindMenuHold 1 秒长按切换锁定），
    单击改为 tapNoteKey(stroke)：点被锁定的键＝解锁，点其他键＝原来的写入并前进；键盘重建后 paintNoteLock() 恢复锁定样式；
    键盘收起（keysOpen = false）时自动解锁。
  · 新增 setNoteLock / paintNoteLock / unlockNote / toggleNoteLock / tapNoteKey / writeLockedStroke。
    writeLockedStroke()：在点中的位置写入锁定音符、光标不前进；该位置已是同一音符则清除；锁定「休止」则清除；
    点到不含该音符的乐器（如 Kenkeni 上锁定了低音）只选中并提示。
  · 符杆单击处理：锁定时单击＝选中并 writeLockedStroke()，不再用双击打开拍菜单（按住 1 秒仍可打开拍菜单）；蓝点（左右手）不受影响。
  · Esc 先解锁；长按另一个键改锁该键。style.css：.key.locked 蓝底白字带白点，锁定时谱面光标为 copy。""",
    'common': """关于页「本版更新」文字（help.aboutUpdate）描述本轮三项改动。""",
}


def lines_of(path):
    return path.read_text(encoding='utf-8').split('\n')


def locate(text, passage):
    """Every occurrence of `passage`, widened to whole lines: [(first_line, last_line, lines_text)]."""
    found, start = [], 0
    while passage and (index := text.find(passage, start)) >= 0:
        line_start = text.rfind('\n', 0, index) + 1
        end = index + len(passage) - (1 if passage.endswith('\n') else 0)
        line_end = text.find('\n', end)
        line_end = len(text) if line_end < 0 else line_end
        first = text.count('\n', 0, line_start) + 1
        whole = text[line_start:line_end]
        found.append((first, first + whole.count('\n'), whole))
        start = index + len(passage)
    return found


def numbered(passage, first):
    rows = passage.split('\n')
    width = len(str(first + len(rows) - 1))
    return '\n'.join(f'{first + i:>{width}} | {row}' for i, row in enumerate(rows))


def where(found):
    if not found:
        return '（本轮后续修改又改动了这段，最终代码见后面的修改）'
    return '、'.join(f'第 {a} 行' if a == b else f'第 {a}–{b} 行' for a, b, _ in found)


def block(title, passage, found):
    out = [f'【{title}】{where(found) if passage else ""}', RULE]
    if passage == '':
        out.append('（整段删除，此处不再有代码）')
    elif not found:
        out.append(passage)
    else:
        for index, (first, _, whole) in enumerate(found):
            if index:
                out.append('……')
            out.append(numbered(whole, first))
    out.append(RULE)
    return out


def edits_section(module, version_from, version_to, before_dir, after_dir, summaries):
    out = []
    before_text = {kind: (before_dir / UI / name).read_text(encoding='utf-8') for kind, name in module.FILES.items()}
    after_text = {kind: (after_dir / UI / name).read_text(encoding='utf-8') for kind, name in module.FILES.items()}
    android_before = (before_dir / 'index.html').read_text(encoding='utf-8')
    android_after = (after_dir / 'index.html').read_text(encoding='utf-8')
    order = list(module.SECTIONS)
    number = 0
    for tag in order:
        items = [e for e in module.EDITS if e[3] == tag]
        out += ['', HEAVY, f'{module.SECTIONS[tag]}（{version_from} → {version_to}）', HEAVY, '', '修改说明：', '  ' + summaries[tag], '',
                f'本需求共 {len(items)} 处代码修改。每处修改同时写入 Win11 源码与安卓页面 assets/index.html（两者代码相同，行号不同）。']
        for kind, old, new, _, *rest in items:
            number += 1
            name = module.FILES[kind]
            out += ['', f'修改 {number}：{UI.replace("RhythmDesk-Win11/", "")}{name}'
                    + (f'（同一写法出现 {rest[0]} 处，全部替换）' if rest and rest[0] > 1 else ''),
                    f'  安卓 assets/index.html：修改前 {where(locate(android_before, old))}；修改后 {where(locate(android_after, new)) if new else "（删除）"}']
            out += block(f'修改前 {version_from}', old, locate(before_text[kind], old))
            out += block(f'修改后 {version_to}', new, locate(after_text[kind], new) if new else [])
    return out


def span(first, last):
    return f'第 {first} 行' if first == last else f'第 {first}–{last} 行'


def diff_blocks(label, before_lines, after_lines, version_from, version_to, after_numbering=False):
    """Before/after blocks for each changed run of lines. With after_numbering, both blocks use the
    line numbers of the new file (used where the old side already carries this round's feature edits)."""
    out = []
    matcher = difflib.SequenceMatcher(a=before_lines, b=after_lines, autojunk=False)
    for op, a1, a2, b1, b2 in matcher.get_opcodes():
        if op == 'equal':
            continue
        first = b1 + 1 if after_numbering else a1 + 1
        note = f'（{version_to} 文件行号，版本号替换不改变行数）' if after_numbering else ''
        before = '\n'.join(before_lines[a1:a2])
        after = '\n'.join(after_lines[b1:b2])
        out += ['', label,
                f'【修改前 {version_from}】' + (span(first, first + a2 - a1 - 1) + note if a2 > a1 else f'（第 {a1} 行之后，原无此内容）'), RULE,
                numbered(before, first) if a2 > a1 else '（无）', RULE,
                f'【修改后 {version_to}】' + (span(b1 + 1, b2) if b2 > b1 else '（删除）'), RULE,
                numbered(after, b1 + 1) if b2 > b1 else '（删除）', RULE]
    return out


def apply_edits(module, kind, text):
    for k, old, new, _, *rest in module.EDITS:
        if k == kind:
            text = text.replace(old, new)
    return text


def other_changes(module, version_from, version_to, before_dir, after_dir, extra_files, renamed):
    out = ['', HEAVY, f'版本号、说明文件、测试与其他文件（{version_from} → {version_to}）', HEAVY,
           '以下改动不属于上面的功能修改清单，按文件逐段列出修改前／修改后。']
    for kind, name in module.FILES.items():
        before = apply_edits(module, kind, (before_dir / UI / name).read_text(encoding='utf-8')).split('\n')
        after = lines_of(after_dir / UI / name)
        if before != after:
            out += ['', f'■ {UI.replace("RhythmDesk-Win11/", "")}{name}：版本号与日期（功能修改之外的差异）']
            out += diff_blocks(f'{name}', before, after, version_from, version_to, after_numbering=True)
    for name in extra_files:
        a, b = before_dir / name, after_dir / name
        old_name = renamed.get(name)
        if old_name:
            a = before_dir / old_name
        if not b.exists():
            continue
        before = lines_of(a) if a.exists() else []
        after = lines_of(b)
        if before == after:
            continue
        title = f'■ {name.replace("RhythmDesk-Win11/", "")}' + (f'（由 {old_name.split("/")[-1]} 改名）' if old_name else '')
        out += ['', title]
        out += diff_blocks(name.split('/')[-1], before, after, version_from, version_to)
    return out


def android_page_extra(version_from, version_to, before_dir, after_dir, module):
    """Android page differences beyond the edit list: only version strings are expected."""
    before = (before_dir / 'index.html').read_text(encoding='utf-8')
    for kind in module.FILES:
        before = apply_edits(module, kind, before)
    after = (after_dir / 'index.html').read_text(encoding='utf-8')
    strip = lambda text: re.sub(r'data:[a-z/+-]+;base64,[A-Za-z0-9+/=]+', 'DATA…', text).split('\n')
    out = ['', f'■ 安卓 assets/index.html：版本号与日期（功能修改之外的差异）']
    out += diff_blocks('assets/index.html', strip(before), strip(after), version_from, version_to, after_numbering=True)
    return out


def appendix_files(files):
    out = []
    for path, title in files:
        shown = 'RhythmDesk-Win11/' + Path(path).as_posix().split('/RhythmDesk-Win11/', 1)[1]
        out += ['', HEAVY, title, HEAVY, f'文件：{shown}', RULE, numbered(Path(path).read_text(encoding='utf-8').rstrip('\n'), 1), RULE]
    return out


def main():
    out = [
        'RhythmDesk（鼓谱工作台）开发交接文档',
        f'覆盖范围：1.59（接手时的版本）→ 1.60 → 1.61 → 1.62 → 1.63 → 1.64 → 1.65 → 1.66',
        '编写日期：2026-11-22',
        '',
        HEAVY, '一、项目结构与两个平台的关系', HEAVY, """
1. Windows 11 版（RhythmDesk-Win11/）
   · RhythmDesk.exe：启动器，用 Edge 打开同目录的 RhythmDesk.html（exe 本身未改动，不含版本号）。
   · RhythmDesk.html：单文件离线编辑器，由 source/build_ui.py 把 source/ui 下的
     index.html + style.css + i18n.js + model.js + presets.js + user-recordings.js + audio.js + score-export.js + app.js
     和 help/ 说明书（图片转 base64）拼装生成。修改代码只改 source/ui，再运行 python3 source/build_ui.py。
   · sounds/：音色（TimGM6mb，GPL-2.0），source/tests/：测试，source/iphone-offline/：iPhone 离线版打包脚本（本次只同步了版本号，未生成 iPhone 包，
     因为它需要的 RhythmDesk-iPhone-Web 网页包不在接手的压缩包中）。

2. 安卓版（RhythmDesk-Android-x.xx.apk，包名 org.rhythmdesk.app，minSdk 26，targetSdk 34）
   · 外壳 classes.dex（WebView）未改动；编辑器是 APK 内的 assets/index.html，它和 Win11 页面使用同一套脚本、样式和说明书，
     另含安卓专用代码（rhythmDeskAndroid 标志、系统保存窗口桥接、androidFollow* 跟随实现、内嵌音色数据、安卓版说明书文字）。
   · 接手的压缩包没有安卓 index.html 的拆分源码，因此每轮修改都写成补丁清单（tools/patch160.py … tools/patch166.py），
     同一份清单同时作用于 Win11 源码和安卓 index.html：每处修改必须在两边都恰好匹配规定次数，否则整个补丁不写入。
     这保证两个平台的改动完全一致。生成后还比对了「Win11 页面 与 安卓页面」的差异，确认只剩原有的安卓专用部分。
   · APK 重新打包：tools/repack_apk.py 以上一版已签名 APK 为基础，只替换 assets/index.html 和二进制 AndroidManifest.xml 中的
     versionCode/versionName，其余条目内容不变，resources.arsc 保持不压缩并 4 字节对齐。
   · 签名：tools/SignApk.java 调用 com.android.tools.build:apksig:2.3.0（Maven Central）以 APK Signature Scheme v2 签名
     （与接手时 1.59 包相同的方案）。私钥 PEM 由项目负责人保管，不在代码仓库中（.gitignore 忽略 *.pem）。
     证书：CN=RhythmDesk Android Releases，SHA-256 指纹
     7E:CB:F5:86:D6:AD:73:D4:2D:A0:6C:77:3C:58:6F:E1:38:4E:4A:B3:46:D9:CC:6C:AD:CE:34:77:69:A4:B7:4F
     与 1.59 原包一致，因此新版可直接覆盖安装。tools/verify_v2.py 独立校验 v2 签名、内容摘要和对齐。

3. 构建命令
   python3 RhythmDesk-Win11/source/build_ui.py
   python3 tools/patch166.py RhythmDesk-Win11/source/ui android/index.html      （在 1.65 源码上应用 1.66 修改，已应用过的不要重复执行）
   python3 tools/repack_apk.py 上一版.apk android/index.html unsigned.apk 1.66
   java --add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED \\
        --add-exports java.base/sun.security.util=ALL-UNNAMED -cp apksig-2.3.0.jar tools/SignApk.java 签名.pem unsigned.apk RhythmDesk-Android-1.66.apk
   python3 tools/verify_v2.py RhythmDesk-Android-1.66.apk

4. 测试（RhythmDesk-Win11/source/tests）
   node interaction166.cjs                                  双击计时、滚轮缩放、拖动、保存流程、诊断文件版本
   node playback166.cjs 安卓index.html ../../RhythmDesk.html  安卓页面与浏览器页面播放跟随轨迹一致、循环释放规则
   node offline166.cjs 解压后的iPhone离线包目录                 iPhone 离线版 service worker（需要先生成 iPhone 包）
   node editor160.e2e.cjs 页面...                            （需 Playwright + Chromium）1.60 三项功能：复制轨道、带音符切分、长按菜单（1.66 起为 0.1 秒）
   node editor161.e2e.cjs 页面...                            （需 Playwright + Chromium）1.61/1.62 功能：再循环次数（自由输入）、竖向蓝色播放方框、音符锁定
   node editor163.e2e.cjs 页面...                            （需 Playwright + Chromium）1.63 功能：每个循环预设次数、0.5 秒长按、双击菜单避让
   node editor164.e2e.cjs 页面...                            （需 Playwright + Chromium）1.64：多选半透明选框（按像素检查竖线与音符可见）
   node editor165.e2e.cjs 页面...                            （需 Playwright + Chromium）长按时长（1.65 新增，1.66 起全部 0.1 秒）：菜单、首页卡片、音符锁定，以及轻点仍能选中和输入
   1.66 发布前上述测试（offline 除外）在 Win11 页面和从已签名 APK 中取出的页面上全部通过；未在安卓真机和 Windows Edge 上实测。

5. 版本记录
   1.59  接手版本（2026-11-17）。安卓 versionCode 159。
   1.60  2026-11-21：复制本轨道；写入音符状态下直接切分；双击菜单支持长按 1 秒并避开按压位置。versionCode 160。
   1.61  2026-11-22：循环「再循环 N 次后继续」按钮；所有轨道蓝色方框显示播放位置；长按音符键锁定点按输入。versionCode 161。
   1.62  2026-11-22：再循环次数自由输入（1–999）；播放位置改为竖向蓝色长方框覆盖符杆；说明文件核对同步；修复剩余次数不刷新。versionCode 162。
   1.63  2026-11-22：每个循环区间预设循环次数并自动继续；所有长按改为 0.5 秒；双击打开的菜单避开点按位置；说明书同步。versionCode 163。
   1.64  2026-11-22：多选模式中单个选中的符杆改为半透明蓝框（粘贴覆盖预览同样半透明）。versionCode 164。
   1.65  2026-11-22：所有长按菜单（含首页卡片菜单）改为 0.2 秒；音符锁定与锁定时符杆保留 0.5 秒。versionCode 165。
   1.66  2026-11-22：所有长按菜单与音符锁定都改为 0.1 秒。versionCode 166。
""".strip('\n'),
        '', HEAVY, '二、提示词汇总', HEAVY,
        '第 1 段提示词（初次接手，产出 1.60）：', PROMPT_1, '',
        '  拆分为三项需求：',
        '  需求 1：乐器轨道菜单加入「复制本轨道」，复制包括音符在内的所有内容。',
        '  需求 2：编辑乐谱时切分按钮不需要先清除音符，在写入音符状态下直接修改。',
        '  需求 3：所有需要双击激活的菜单也可长按激活，长按 1 秒，激活后的菜单避开长按位置防止误按。',
        '  另：同步到 Win11 与安卓两个平台的后续版本（1.60），安卓用压缩包中的签名文件签名。', '',
        '第 2 段提示词（产出 1.61 和本文档）：', PROMPT_2, '',
        '  拆分为四项需求：',
        '  需求 1：循环区间中按方块向后继续播放时，增加「再循环几次」的按钮功能。',
        '  需求 2：播放时所有轨道显示音符播放位置，显示方式改为蓝色方框框住音符。',
        '  需求 3：音符键盘上长按音符键，切换为锁定该音符、点按谱面输入该音符的模式。',
        '  需求 4：整理本交接文档（本文件）。', '',
        '第 3 段提示词（产出 1.62，并更新本文档）：', PROMPT_3, '',
        '  拆分为三项需求：',
        '  需求 1：循环次数可以自由填写，不用设定成固定次数。',
        '  需求 2：核对修改后的说明文件，不一致处同步更新。',
        '  需求 3：播放时跟随显示的蓝色方框改为竖向长方形，覆盖住竖线（符杆）部分。', '',
        '第 4 段提示词（产出 1.63，并延续本文档）：', PROMPT_4, '',
        '  拆分为四项需求：',
        '  需求 1：每个循环区域可预设循环次数；同一轨道有多个循环时各自预设，播完自动向后播放。',
        '  需求 2：所有长按激活的菜单，长按时长改为 0.5 秒。',
        '  需求 3：双击激活弹出的菜单也要让开点击位置，避免误点。',
        '  需求 4：同步修正说明书，并延续交接文档。', '',
        '第 5 段提示词（产出 1.64，并延续本文档）：', PROMPT_5, '',
        '  需求 1：多选模式下，单个点选符杆时的蓝色选框改为半透明，能看到竖线和音符的谱面状态。',
        '  （按惯例同步说明书并延续本交接文档。）', '',
        '第 6 段提示词（产出 1.65，并延续本文档）：', PROMPT_6, '',
        '  需求 1：所有长按激活的菜单，激活时间改为长按 0.2 秒。',
        '  （按惯例同步说明书并延续本交接文档。）', '',
        '第 7 段提示词（产出 1.66，并延续本文档）：', PROMPT_7, '',
        '  需求 1：所有长按激活的菜单，激活时间改为长按 0.1 秒。',
        '  需求 2：音符锁定也改为长按 0.1 秒激活（1.65 中保留的 0.5 秒取消）。',
        '  （按惯例同步说明书并延续本交接文档。）',
        '',
        HEAVY, '三、第 1 段提示词的程序修改（1.59 → 1.60）', HEAVY,
        '说明：「修改前」取自 1.59 原文件，「修改后」取自 1.60 文件，行号为各自文件中的行号；路径相对于 RhythmDesk-Win11/。',
        '本轮补丁清单：tools/patch160.py（52 处修改）。',
    ]
    out += edits_section(patch160, '1.59', '1.60', V159, V160, SUMMARY_1)
    files_1 = ['RhythmDesk-Win11/Readme.txt', 'RhythmDesk-Win11/source/Readme-Win11.txt',
               'RhythmDesk-Win11/source/tests/interaction160.cjs', 'RhythmDesk-Win11/source/tests/playback160.cjs',
               'RhythmDesk-Win11/source/tests/offline160.cjs',
               'RhythmDesk-Win11/source/iphone-offline/sw.js', 'RhythmDesk-Win11/source/iphone-offline/install.html',
               'RhythmDesk-Win11/source/iphone-offline/local-fallback.html', 'RhythmDesk-Win11/source/iphone-offline/Readme.txt',
               'RhythmDesk-Win11/source/iphone-offline/build.py']
    renamed_1 = {f'RhythmDesk-Win11/source/tests/{n}160.cjs': f'RhythmDesk-Win11/source/tests/{n}159.cjs'
                 for n in ('interaction', 'playback', 'offline')}
    out += other_changes(patch160, '1.59', '1.60', V159, V160, files_1, renamed_1)
    out += android_page_extra('1.59', '1.60', V159, V160, patch160)
    out += ['', '■ 安卓 AndroidManifest.xml（二进制）', RULE,
            '修改前 1.59：versionCode = 159，versionName = "1.59"',
            '修改后 1.60：versionCode = 160，versionName = "1.60"（其余属性不变：package org.rhythmdesk.app、minSdk 26、targetSdk 34）', RULE,
            '', '■ 新增文件（修改前不存在）',
            '  RhythmDesk-Win11/source/tests/editor160.e2e.cjs  —— 1.60 功能的 Playwright 测试，全文见附录 A。',
            '  tools/patch160.py、tools/repack_apk.py、tools/SignApk.java、tools/axml.py、tools/verify_v2.py —— 补丁、打包、签名、校验工具（在代码仓库 tools/ 中，不属于软件本体）。']

    out += ['', HEAVY, '四、第 2 段提示词的程序修改（1.60 → 1.61）', HEAVY,
            '说明：「修改前」取自 1.60 文件，「修改后」取自 1.61 文件，行号为各自文件中的行号；路径相对于 RhythmDesk-Win11/。',
            f'本轮补丁清单：tools/patch161.py（{len(patch161.EDITS)} 处修改）。']
    out += edits_section(patch161, '1.60', '1.61', V160, V161, SUMMARY_2)
    files_2 = ['RhythmDesk-Win11/Readme.txt', 'RhythmDesk-Win11/source/Readme-Win11.txt',
               'RhythmDesk-Win11/source/tests/interaction161.cjs', 'RhythmDesk-Win11/source/tests/playback161.cjs',
               'RhythmDesk-Win11/source/tests/offline161.cjs',
               'RhythmDesk-Win11/source/iphone-offline/sw.js', 'RhythmDesk-Win11/source/iphone-offline/install.html',
               'RhythmDesk-Win11/source/iphone-offline/local-fallback.html', 'RhythmDesk-Win11/source/iphone-offline/Readme.txt',
               'RhythmDesk-Win11/source/iphone-offline/build.py']
    renamed_2 = {f'RhythmDesk-Win11/source/tests/{n}161.cjs': f'RhythmDesk-Win11/source/tests/{n}160.cjs'
                 for n in ('interaction', 'playback', 'offline')}
    out += other_changes(patch161, '1.60', '1.61', V160, V161, files_2, renamed_2)
    out += android_page_extra('1.60', '1.61', V160, V161, patch161)
    out += ['', '■ 安卓 AndroidManifest.xml（二进制）', RULE,
            '修改前 1.60：versionCode = 160，versionName = "1.60"',
            '修改后 1.61：versionCode = 161，versionName = "1.61"', RULE,
            '', '■ 新增文件（修改前不存在）',
            '  RhythmDesk-Win11/source/tests/editor161.e2e.cjs  —— 1.61 功能的 Playwright 测试，全文见附录 B。',
            '  tools/patch161.py、tools/make_handoff.py（生成本文档）；tools/repack_apk.py 改为通用版本参数。',
            '',
            '■ 本轮开发中的注意点',
            '  · 版本号替换只替换「1.60 ·」「\'1.60\'」「-1.60.json」形式的版本字符串：代码注释「// 1.60: …」保留引入时的版本；',
            '    audio.js 的音色合成表里有一个常数 1.60（dundunba:M 参数，原始数据），不能被当成版本号替换。',
            '  · gateLoopsBack 写成函数声明并放在 PlaybackCursor 类之后，因为 playback161.cjs 按「class PlaybackCursor { … async function exportBacking(」',
            '    截取代码执行；函数声明会提升，在拼装后的页面里位置不影响使用。',
            '  · 音符锁定复用了 1.60 的 bindMenuHold（1 秒、移动取消、松手不触发单击），与菜单长按的手感一致。']

    out += ['', HEAVY, '五、第 3 段提示词的程序修改（1.61 → 1.62）', HEAVY,
            '说明：「修改前」取自 1.61 文件，「修改后」取自 1.62 文件，行号为各自文件中的行号；路径相对于 RhythmDesk-Win11/。',
            f'本轮补丁清单：tools/patch162.py（{len(patch162.EDITS)} 处修改）。']
    out += edits_section(patch162, '1.61', '1.62', V161, V162, SUMMARY_3)
    files_3 = ['RhythmDesk-Win11/Readme.txt', 'RhythmDesk-Win11/source/Readme-Win11.txt',
               'RhythmDesk-Win11/source/tests/interaction162.cjs', 'RhythmDesk-Win11/source/tests/playback162.cjs',
               'RhythmDesk-Win11/source/tests/offline162.cjs', 'RhythmDesk-Win11/source/tests/editor161.e2e.cjs',
               'RhythmDesk-Win11/source/iphone-offline/sw.js', 'RhythmDesk-Win11/source/iphone-offline/install.html',
               'RhythmDesk-Win11/source/iphone-offline/local-fallback.html', 'RhythmDesk-Win11/source/iphone-offline/Readme.txt']
    renamed_3 = {f'RhythmDesk-Win11/source/tests/{n}162.cjs': f'RhythmDesk-Win11/source/tests/{n}161.cjs'
                 for n in ('interaction', 'playback', 'offline')}
    out += other_changes(patch162, '1.61', '1.62', V161, V162, files_3, renamed_3)
    out += android_page_extra('1.61', '1.62', V161, V162, patch162)
    out += ['', '■ 安卓 AndroidManifest.xml（二进制）', RULE,
            '修改前 1.61：versionCode = 161，versionName = "1.61"',
            '修改后 1.62：versionCode = 162，versionName = "1.62"', RULE,
            '', '■ 新增文件：tools/patch162.py。发布日期与 1.61 同为 2026-11-22，因此日期字符串未改。',
            '',
            '■ 本轮开发中的注意点',
            '  · 剩余次数不刷新的问题是在 1.62 截图核对时发现的（弹窗显示 11 次、按钮仍显示 12 次），已修复并加入测试：',
            '    editor161.e2e.cjs 现在检查「再循环 2 次」后按钮会变为「再循环 1 次」，停止按钮提示同步变化。',
            '  · 测试 playback162.cjs 在沙箱中逐个预置应用的全局状态，新增全局变量时需要同步加入（本轮加入 playingLoopState）。']

    out += ['', HEAVY, '六、第 4 段提示词的程序修改（1.62 → 1.63）', HEAVY,
            '说明：「修改前」取自 1.62 文件，「修改后」取自 1.63 文件，行号为各自文件中的行号；路径相对于 RhythmDesk-Win11/。',
            f'本轮补丁清单：tools/patch163.py（{len(patch163.EDITS)} 处修改）。']
    out += edits_section(patch163, '1.62', '1.63', V162, V163, SUMMARY_4)
    files_4 = ['RhythmDesk-Win11/Readme.txt', 'RhythmDesk-Win11/source/Readme-Win11.txt',
               'RhythmDesk-Win11/source/tests/interaction163.cjs', 'RhythmDesk-Win11/source/tests/playback163.cjs',
               'RhythmDesk-Win11/source/tests/offline163.cjs', 'RhythmDesk-Win11/source/tests/editor160.e2e.cjs',
               'RhythmDesk-Win11/source/tests/editor161.e2e.cjs',
               'RhythmDesk-Win11/source/iphone-offline/sw.js', 'RhythmDesk-Win11/source/iphone-offline/install.html',
               'RhythmDesk-Win11/source/iphone-offline/local-fallback.html', 'RhythmDesk-Win11/source/iphone-offline/Readme.txt']
    renamed_4 = {f'RhythmDesk-Win11/source/tests/{n}163.cjs': f'RhythmDesk-Win11/source/tests/{n}162.cjs'
                 for n in ('interaction', 'playback', 'offline')}
    out += other_changes(patch163, '1.62', '1.63', V162, V163, files_4, renamed_4)
    out += android_page_extra('1.62', '1.63', V162, V163, patch163)
    out += ['', '■ 安卓 AndroidManifest.xml（二进制）', RULE,
            '修改前 1.62：versionCode = 162，versionName = "1.62"',
            '修改后 1.63：versionCode = 163，versionName = "1.63"', RULE,
            '', '■ 新增文件（修改前不存在）',
            '  RhythmDesk-Win11/source/tests/editor163.e2e.cjs  —— 1.63 功能的 Playwright 测试，全文见附录 C。',
            '  tools/patch163.py。发布日期与 1.62 同为 2026-11-22，因此日期字符串未改。',
            '',
            '■ 本轮开发中的注意点',
            '  · 预设次数按「共几遍（含第一遍）」计，与方块上方「↻ 再循环…」的「再循环几次（本轮之后）」不同：预设 3 遍时，进入循环后按钮显示「再循环 2 次」。',
            '  · 设置次数会停止正在进行的播放（与添加、移除、修改循环终点一致），因为它属于鼓谱修改；临时调整请用「↻ 再循环…」。',
            '  · 测试 editor160/editor161 中的长按时长改为 0.65 秒（应打开）与 0.25 秒（不应打开）；editor163 另验证 0.3 秒不打开、0.7 秒打开。',
            '  · 用 1.62 页面对照：双击小节线时菜单覆盖点按位置（距离 −89 px），1.63 为 44 px，说明 editor163 的避让检查确实有效。']

    out += ['', HEAVY, '七、第 5 段提示词的程序修改（1.63 → 1.64）', HEAVY,
            '说明：「修改前」取自 1.63 文件，「修改后」取自 1.64 文件，行号为各自文件中的行号；路径相对于 RhythmDesk-Win11/。',
            f'本轮补丁清单：tools/patch164.py（{len(patch164.EDITS)} 处修改）。']
    out += edits_section(patch164, '1.63', '1.64', V163, V164, SUMMARY_5)
    files_5 = ['RhythmDesk-Win11/Readme.txt', 'RhythmDesk-Win11/source/Readme-Win11.txt',
               'RhythmDesk-Win11/source/tests/interaction164.cjs', 'RhythmDesk-Win11/source/tests/playback164.cjs',
               'RhythmDesk-Win11/source/tests/offline164.cjs',
               'RhythmDesk-Win11/source/iphone-offline/sw.js', 'RhythmDesk-Win11/source/iphone-offline/install.html',
               'RhythmDesk-Win11/source/iphone-offline/local-fallback.html', 'RhythmDesk-Win11/source/iphone-offline/Readme.txt']
    renamed_5 = {f'RhythmDesk-Win11/source/tests/{n}164.cjs': f'RhythmDesk-Win11/source/tests/{n}163.cjs'
                 for n in ('interaction', 'playback', 'offline')}
    out += other_changes(patch164, '1.63', '1.64', V163, V164, files_5, renamed_5)
    out += android_page_extra('1.63', '1.64', V163, V164, patch164)
    out += ['', '■ 安卓 AndroidManifest.xml（二进制）', RULE,
            '修改前 1.63：versionCode = 163，versionName = "1.63"',
            '修改后 1.64：versionCode = 164，versionName = "1.64"', RULE,
            '', '■ 新增文件（修改前不存在）',
            '  RhythmDesk-Win11/source/tests/editor164.e2e.cjs  —— 1.64 的 Playwright 测试（含一个读取截图 PNG 的小解码器），全文见附录 D。',
            '  tools/patch164.py。发布日期与 1.63 同为 2026-11-22，因此日期字符串未改。']

    out += ['', HEAVY, '八、第 6 段提示词的程序修改（1.64 → 1.65）', HEAVY,
            '说明：「修改前」取自 1.64 文件，「修改后」取自 1.65 文件，行号为各自文件中的行号；路径相对于 RhythmDesk-Win11/。',
            f'本轮补丁清单：tools/patch165.py（{len(patch165.EDITS)} 处修改）。']
    out += edits_section(patch165, '1.64', '1.65', V164, V165, SUMMARY_6)
    files_6 = ['RhythmDesk-Win11/Readme.txt', 'RhythmDesk-Win11/source/Readme-Win11.txt',
               'RhythmDesk-Win11/source/tests/interaction165.cjs', 'RhythmDesk-Win11/source/tests/playback165.cjs',
               'RhythmDesk-Win11/source/tests/offline165.cjs', 'RhythmDesk-Win11/source/tests/editor160.e2e.cjs',
               'RhythmDesk-Win11/source/tests/editor163.e2e.cjs',
               'RhythmDesk-Win11/source/iphone-offline/sw.js', 'RhythmDesk-Win11/source/iphone-offline/install.html',
               'RhythmDesk-Win11/source/iphone-offline/local-fallback.html', 'RhythmDesk-Win11/source/iphone-offline/Readme.txt']
    renamed_6 = {f'RhythmDesk-Win11/source/tests/{n}165.cjs': f'RhythmDesk-Win11/source/tests/{n}164.cjs'
                 for n in ('interaction', 'playback', 'offline')}
    out += other_changes(patch165, '1.64', '1.65', V164, V165, files_6, renamed_6)
    out += android_page_extra('1.64', '1.65', V164, V165, patch165)
    out += ['', '■ 安卓 AndroidManifest.xml（二进制）', RULE,
            '修改前 1.64：versionCode = 164，versionName = "1.64"',
            '修改后 1.65：versionCode = 165，versionName = "1.65"', RULE,
            '', '■ 新增文件（修改前不存在）',
            '  RhythmDesk-Win11/source/tests/editor165.e2e.cjs  —— 1.65 的 Playwright 测试，全文见附录 E。',
            '  tools/patch165.py。发布日期与 1.64 同为 2026-11-22，因此日期字符串未改。']

    out += ['', HEAVY, '九、第 7 段提示词的程序修改（1.65 → 1.66）', HEAVY,
            '说明：「修改前」取自 1.65 文件，「修改后」取自 1.66 文件，行号为各自文件中的行号；路径相对于 RhythmDesk-Win11/。',
            f'本轮补丁清单：tools/patch166.py（{len(patch166.EDITS)} 处修改）。']
    out += edits_section(patch166, '1.65', '1.66', V165, V166, SUMMARY_7)
    files_7 = ['RhythmDesk-Win11/Readme.txt', 'RhythmDesk-Win11/source/Readme-Win11.txt',
               'RhythmDesk-Win11/source/tests/interaction166.cjs', 'RhythmDesk-Win11/source/tests/playback166.cjs',
               'RhythmDesk-Win11/source/tests/offline166.cjs', 'RhythmDesk-Win11/source/tests/editor160.e2e.cjs',
               'RhythmDesk-Win11/source/tests/editor163.e2e.cjs', 'RhythmDesk-Win11/source/tests/editor165.e2e.cjs',
               'RhythmDesk-Win11/source/iphone-offline/sw.js', 'RhythmDesk-Win11/source/iphone-offline/install.html',
               'RhythmDesk-Win11/source/iphone-offline/local-fallback.html', 'RhythmDesk-Win11/source/iphone-offline/Readme.txt']
    renamed_7 = {f'RhythmDesk-Win11/source/tests/{n}166.cjs': f'RhythmDesk-Win11/source/tests/{n}165.cjs'
                 for n in ('interaction', 'playback', 'offline')}
    out += other_changes(patch166, '1.65', '1.66', V165, V166, files_7, renamed_7)
    out += android_page_extra('1.65', '1.66', V165, V166, patch166)
    out += ['', '■ 安卓 AndroidManifest.xml（二进制）', RULE,
            '修改前 1.65：versionCode = 165，versionName = "1.65"',
            '修改后 1.66：versionCode = 166，versionName = "1.66"', RULE,
            '', '■ 新增文件：tools/patch166.py。发布日期与 1.65 同为 2026-11-22，因此日期字符串未改。']

    out += ['', HEAVY, '十、后续开发建议', HEAVY, """
  · 新一轮修改沿用同样做法：先在 Win11 源码 source/ui 上设计修改，写成 tools/patchXXX.py 清单同时作用于安卓 index.html，
    构建后比对两平台页面差异，确认只剩原有安卓专用部分；然后重打包、签名、校验、跑测试。
  · 安卓专用代码只存在于 android/index.html（APK 内页面）。修改跟随、保存、下载相关代码时，两个平台写法不同，需分别处理。
  · 签名必须一直使用同一私钥，否则用户无法覆盖安装；versionCode 必须递增。
  · 建议在安卓真机和 Windows 11 Edge 上补做人工验收：长按 0.1 秒的手感（普通单击和输入音符是否常被当成长按、滑动浏览谱面和首页时是否误开菜单或误锁音符）、单击／双击／长按菜单的避让位置、预设循环次数与再循环计数、锁定输入。
""".strip('\n')]
    out += appendix_files([(str(V166 / 'RhythmDesk-Win11/source/tests/editor160.e2e.cjs'), '附录 A：测试 editor160.e2e.cjs（1.60 新增，1.63／1.65／1.66 更新后的全文）'),
                           (str(V166 / 'RhythmDesk-Win11/source/tests/editor161.e2e.cjs'), '附录 B：测试 editor161.e2e.cjs（1.61 新增，1.62／1.63 更新后的全文）'),
                           (str(V166 / 'RhythmDesk-Win11/source/tests/editor163.e2e.cjs'), '附录 C：测试 editor163.e2e.cjs（1.63 新增，1.65／1.66 更新后的全文）'),
                           (str(V166 / 'RhythmDesk-Win11/source/tests/editor164.e2e.cjs'), '附录 D：测试 editor164.e2e.cjs（1.64 新增）'),
                           (str(V166 / 'RhythmDesk-Win11/source/tests/editor165.e2e.cjs'), '附录 E：测试 editor165.e2e.cjs（1.65 新增，1.66 改写后的全文）')])
    text = '\n'.join(out).replace('\n', '\r\n') + '\r\n'
    OUT.write_bytes(b'\xef\xbb\xbf' + text.encode('utf-8'))
    print(f'Wrote {OUT} ({len(out)} blocks, {text.count(chr(10))} lines)')


if __name__ == '__main__':
    main()
