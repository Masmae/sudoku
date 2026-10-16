// Generated from App/Sources/TechniqueContent.swift — keep the two in sync.
// Articles open in a new tab; nothing from those sites is copied here.
export const CONTENT = {
  "fullHouse": {
    "summary": "A row, column or box with exactly one empty cell. The missing digit goes there.",
    "spot": "Scan for units that are almost full.",
    "reference": "https://www.sudokuwiki.org/Getting_Started"
  },
  "hiddenSingle": {
    "summary": "A digit that has only one possible cell left in a row, column or box — even if that cell has other candidates.",
    "spot": "Pick a digit and a box. Cross out every cell that already sees that digit. If one cell is left, that's it.",
    "reference": "https://www.sudokuwiki.org/Getting_Started"
  },
  "nakedSingle": {
    "summary": "A cell where eight of the nine digits are already in its row, column or box, so only one candidate remains.",
    "spot": "With full pencil marks, look for a cell with a single candidate.",
    "reference": "https://www.sudokuwiki.org/Getting_Started"
  },
  "pointing": {
    "summary": "If a digit's candidates inside a box all sit on one row (or column), the box's copy of that digit must be on that line — so the rest of the line can't have it.",
    "spot": "For each box and digit, check whether the candidates line up.",
    "reference": "https://www.sudokuwiki.org/Intersection_Removal"
  },
  "claiming": {
    "summary": "The reverse of pointing: if a digit's candidates in a row (or column) all sit inside one box, the rest of that box can't have the digit.",
    "spot": "For each row/column and digit, check whether the candidates fall in a single box.",
    "reference": "https://www.sudokuwiki.org/Intersection_Removal#LBR"
  },
  "nakedPair": {
    "summary": "Two cells in one unit that both contain exactly the same two candidates. Those two digits are locked into those cells, so remove them from the rest of the unit.",
    "spot": "Look for two identical two-candidate cells in the same row, column or box.",
    "reference": "https://www.sudokuwiki.org/Naked_Candidates#NP"
  },
  "hiddenPair": {
    "summary": "Two digits that, within one unit, can only go in the same two cells. Those cells must hold those digits, so all other candidates in them can go.",
    "spot": "Count where each digit can go in a unit; find two digits sharing the same two spots.",
    "reference": "https://www.sudokuwiki.org/Hidden_Candidates#HP"
  },
  "nakedTriple": {
    "summary": "Three cells in a unit whose candidates, combined, are just three digits (each cell needn't have all three). Remove those digits from the rest of the unit.",
    "spot": "Look for cells with 2–3 candidates drawn from the same three digits.",
    "reference": "https://www.sudokuwiki.org/Naked_Candidates#NT"
  },
  "hiddenTriple": {
    "summary": "Three digits that can only go in the same three cells of a unit. Clear every other candidate from those cells.",
    "spot": "Hard to see by eye — count positions of each digit in a unit.",
    "reference": "https://www.sudokuwiki.org/Hidden_Candidates#HT"
  },
  "nakedQuad": {
    "summary": "Four cells in a unit whose candidates together are only four digits. Those digits can be removed from the rest of the unit.",
    "spot": "Usually found in units with many empty cells.",
    "reference": "https://www.sudokuwiki.org/Naked_Candidates#NQ"
  },
  "hiddenQuad": {
    "summary": "Four digits confined to the same four cells of a unit. Every other candidate in those cells goes.",
    "spot": "Rare. When a unit has a naked set, the remaining cells form a hidden set — find the smaller one.",
    "reference": "https://www.sudokuwiki.org/Hidden_Candidates#HQ"
  },
  "xWing": {
    "summary": "A digit appears exactly twice in each of two rows, and those positions line up in the same two columns. The two rows' copies must occupy those columns, so remove the digit from the rest of both columns. (Works with rows and columns swapped.)",
    "spot": "For one digit, find two rows with only two candidates each, forming the corners of a rectangle.",
    "reference": "https://www.sudokuwiki.org/X_Wing_Strategy"
  },
  "skyscraper": {
    "summary": "Two rows each with only two places for a digit. One end of each lines up in a column (the base); the other ends (the tops) don't. One top must be the digit, so cells seeing both tops lose it.",
    "spot": "Like a broken X-Wing: two conjugate pairs sharing one column.",
    "reference": "https://hodoku.sourceforge.net/en/tech_sdp.php"
  },
  "twoStringKite": {
    "summary": "A row and a column each have only two places for a digit, and one end of each sits in the same box. The two far ends can't both be false, so a cell seeing both far ends loses the digit.",
    "spot": "Look for a row pair and a column pair that meet in one box.",
    "reference": "https://hodoku.sourceforge.net/en/tech_sdp.php"
  },
  "emptyRectangle": {
    "summary": "Inside a box, a digit's candidates all lie on one row plus one column (an L or cross shape). Combined with a strong link outside the box, it removes the digit from one target cell.",
    "spot": "Find a box where a digit's candidates form a cross, then a two-candidate line hitting its row or column.",
    "reference": "https://www.sudokuwiki.org/Empty_Rectangles"
  },
  "xyWing": {
    "summary": "A pivot cell XY sees two pincer cells XZ and YZ. Whatever the pivot is, one pincer becomes Z — so cells seeing both pincers can't be Z.",
    "spot": "Find a two-candidate cell, then two two-candidate cells it sees that each share one digit with it and a common third digit.",
    "reference": "https://www.sudokuwiki.org/Y_Wing_Strategy"
  },
  "xyzWing": {
    "summary": "Like an XY-Wing, but the pivot holds all three digits XYZ. One of the three cells is Z, so only cells seeing all three lose Z.",
    "spot": "A three-candidate pivot with two two-candidate pincers inside its box/line.",
    "reference": "https://www.sudokuwiki.org/XYZ_Wing"
  },
  "wWing": {
    "summary": "Two identical XY cells that don't see each other, joined by a strong link on X (a unit with X in only two places, each end seeing one cell). One of the two cells must be Y.",
    "spot": "Find matching pairs far apart, then a conjugate pair bridging them.",
    "reference": "https://www.sudokuwiki.org/W_Wing_Strategy"
  },
  "swordfish": {
    "summary": "An X-Wing with three rows and three columns. Three rows each have a digit only within the same three columns, so those columns' copies are used up.",
    "spot": "For one digit, find three rows whose candidates span exactly three columns.",
    "reference": "https://www.sudokuwiki.org/Sword_Fish_Strategy"
  },
  "simpleColoring": {
    "summary": "Link every pair of cells where a digit has exactly two spots, coloring alternately. One color is all true, the other all false. A color seeing itself is false (wrap); a cell seeing both colors is false (trap).",
    "spot": "Pick a digit with many two-spot units and build the chain.",
    "reference": "https://www.sudokuwiki.org/Simple_Colouring"
  },
  "uniqueRectangle": {
    "summary": "Four cells in a rectangle over two boxes can't all end up as the same two digits — that pattern would allow two solutions. Since a proper puzzle has one solution, one corner must break the pattern.",
    "spot": "Look for three corners with the same pair, or two pairs plus two cells sharing one extra digit.",
    "reference": "https://www.sudokuwiki.org/Unique_Rectangles"
  },
  "bugPlusOne": {
    "summary": "If every unsolved cell had exactly two candidates, the puzzle would have multiple solutions. When only one cell has three, it must take the digit that appears three times in its units.",
    "spot": "Late in a puzzle, when almost every cell is a pair.",
    "reference": "https://www.sudokuwiki.org/BUG"
  },
  "jellyfish": {
    "summary": "A four-row, four-column fish. Rare, but follows the same logic as X-Wing and Swordfish.",
    "spot": "For one digit, find four rows whose candidates span exactly four columns.",
    "reference": "https://www.sudokuwiki.org/Jelly_Fish_Strategy"
  },
  "xChain": {
    "summary": "A chain on one digit alternating strong links (one of two must be true) and weak links (both can't be true), starting and ending with strong links. One end is true, so cells seeing both ends lose the digit.",
    "spot": "Generalizes Skyscraper and Kite. Follow two-spot units from cell to cell.",
    "reference": "https://www.sudokuwiki.org/X_Cycles"
  },
  "xyChain": {
    "summary": "A chain of two-candidate cells, each seeing the next and sharing a digit. If the first cell isn't Z, the chain forces the last cell to be Z. Cells seeing both ends lose Z.",
    "spot": "Generalizes XY-Wing. Hop between pair cells.",
    "reference": "https://www.sudokuwiki.org/XY_Chains"
  }
};
