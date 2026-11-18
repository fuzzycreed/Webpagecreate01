// 保存済みのテーマを、画面を描く前に反映する（標準テーマが一瞬見えるのを防ぐ）。
// HTMLに直接書かず別ファイルにしているのは、ページ内に書かれたスクリプトを禁止する設定（CSP）にするため。
try {
  document.documentElement.dataset.theme = localStorage.getItem('netcheck-theme') || 'mono';
} catch (e) {
  document.documentElement.dataset.theme = 'mono';
}
