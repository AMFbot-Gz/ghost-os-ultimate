// Génère des suggestions de patches (non-destructif — suggestions seulement)
export function generateSuggestions(analysisResult) {
  const { issues } = analysisResult;
  return issues.map(issue => {
    switch (issue.type) {
      case 'complex_function':
        return { file: issue.file, line: issue.line, type: 'refactor', suggestion: 'Extraire en sous-fonctions (< 50 lignes chacune)', priority: 'medium' };
      case 'technical_debt':
        return { file: issue.file, line: issue.line, type: 'debt', suggestion: `Résoudre: ${issue.detail}`, priority: 'low' };
      case 'debug_logs':
        return { file: issue.file, type: 'cleanup', suggestion: 'Remplacer console.log par logger.debug()', priority: 'low' };
      default:
        return { file: issue.file, type: 'unknown', suggestion: issue.detail, priority: 'low' };
    }
  });
}
