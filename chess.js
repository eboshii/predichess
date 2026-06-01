// Chess.js - Self-contained custom chess engine matching Kotlin board logic
// Includes standard movements, castling, en passant, promotion, checks, draw rules,
// and the special Predichess 'trap' mechanism.

export const PieceType = {
  KING: 'KING',
  QUEEN: 'QUEEN',
  ROOK: 'ROOK',
  BISHOP: 'BISHOP',
  KNIGHT: 'KNIGHT',
  PAWN: 'PAWN'
};

export const PieceColor = {
  WHITE: 'WHITE',
  BLACK: 'BLACK'
};

export const GameResult = {
  ONGOING: 'ONGOING',
  CHECKMATE_WHITE_WINS: 'CHECKMATE_WHITE_WINS',
  CHECKMATE_BLACK_WINS: 'CHECKMATE_BLACK_WINS',
  STALEMATE: 'STALEMATE',
  DRAW_FIFTY_MOVE: 'DRAW_FIFTY_MOVE',
  DRAW_THREEFOLD: 'DRAW_THREEFOLD',
  DRAW_INSUFFICIENT: 'DRAW_INSUFFICIENT'
};

export class ChessMove {
  constructor(fromRow, fromCol, toRow, toCol, promotion = null) {
    this.fromRow = fromRow;
    this.fromCol = fromCol;
    this.toRow = toRow;
    this.toCol = toCol;
    this.promotion = promotion; // PieceType
  }

  toUci() {
    const files = 'abcdefgh';
    const promoChar = this.promotion ? {
      [PieceType.QUEEN]: 'q',
      [PieceType.ROOK]: 'r',
      [PieceType.BISHOP]: 'b',
      [PieceType.KNIGHT]: 'n'
    }[this.promotion] : '';
    return `${files[this.fromCol]}${8 - this.fromRow}${files[this.toCol]}${8 - this.toRow}${promoChar}`;
  }
}

export class ChessBoard {
  constructor() {
    this.squares = Array(8).fill(null).map(() => Array(8).fill(null));
    this.castlingRights = [true, true, true, true]; // [WK, WQ, BK, BQ]
    this.enPassantTarget = null; // {row, col}
    this.halfMoveClock = 0;
    this.currentTurn = PieceColor.WHITE;
    this.positionHistory = {}; // positionKey -> count
    this.reset();
  }

  reset() {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        this.squares[r][c] = null;
      }
    }

    const backRow = [
      PieceType.ROOK, PieceType.KNIGHT, PieceType.BISHOP, PieceType.QUEEN,
      PieceType.KING, PieceType.BISHOP, PieceType.KNIGHT, PieceType.ROOK
    ];

    for (let c = 0; c < 8; c++) {
      this.squares[0][c] = { type: backRow[c], color: PieceColor.BLACK };
      this.squares[1][c] = { type: PieceType.PAWN, color: PieceColor.BLACK };
      this.squares[6][c] = { type: PieceType.PAWN, color: PieceColor.WHITE };
      this.squares[7][c] = { type: backRow[c], color: PieceColor.WHITE };
    }

    this.castlingRights = [true, true, true, true];
    this.enPassantTarget = null;
    this.halfMoveClock = 0;
    this.currentTurn = PieceColor.WHITE;
    this.positionHistory = {};
    this.positionHistory[this.positionKey()] = 1;
  }

  applyMoves(events) {
    this.reset();
    events.forEach(event => {
      if (event.startsWith('trap:')) {
        this.applyTrap(event.substring(5));
      } else {
        this.applyMove(event);
      }
    });
  }

  applyMove(uci) {
    const move = this.parseUci(uci);
    if (move) {
      this.applyChessMove(move);
    }
  }

  applyTrap(fromSquare) {
    if (fromSquare.length < 2) return;
    const col = fromSquare.charCodeAt(0) - 'a'.charCodeAt(0);
    const row = 8 - parseInt(fromSquare[1], 10);
    if (row >= 0 && row < 8 && col >= 0 && col < 8) {
      this.squares[row][col] = null;
    }
    this.halfMoveClock = 0;
    const key = this.positionKey();
    this.positionHistory[key] = (this.positionHistory[key] || 0) + 1;
  }

  parseUci(uci) {
    if (uci.length < 4) return null;
    const fc = uci.charCodeAt(0) - 'a'.charCodeAt(0);
    const fr = 8 - parseInt(uci[1], 10);
    const tc = uci.charCodeAt(2) - 'a'.charCodeAt(0);
    const tr = 8 - parseInt(uci[3], 10);
    
    let promo = null;
    if (uci.length >= 5) {
      const char = uci[4].toLowerCase();
      if (char === 'q') promo = PieceType.QUEEN;
      else if (char === 'r') promo = PieceType.ROOK;
      else if (char === 'b') promo = PieceType.BISHOP;
      else if (char === 'n') promo = PieceType.KNIGHT;
    }
    return new ChessMove(fr, fc, tr, tc, promo);
  }

  applyChessMove(move) {
    const piece = this.squares[move.fromRow][move.fromCol];
    if (!piece) return;

    const isCapture = this.squares[move.toRow][move.toCol] !== null;
    const epTarget = this.enPassantTarget;
    const isEnPassant = piece.type === PieceType.PAWN && epTarget &&
                        move.toRow === epTarget.row && move.toCol === epTarget.col;
    const isCastle = piece.type === PieceType.KING && Math.abs(move.toCol - move.fromCol) === 2;

    if (piece.type === PieceType.PAWN || isCapture || isEnPassant) {
      this.halfMoveClock = 0;
    } else {
      this.halfMoveClock++;
    }

    if (piece.type === PieceType.PAWN && Math.abs(move.toRow - move.fromRow) === 2) {
      this.enPassantTarget = {
        row: Math.floor((move.fromRow + move.toRow) / 2),
        col: move.fromCol
      };
    } else {
      this.enPassantTarget = null;
    }

    // Update castling rights
    if (piece.type === PieceType.KING) {
      if (piece.color === PieceColor.WHITE) {
        this.castlingRights[0] = false;
        this.castlingRights[1] = false;
      } else {
        this.castlingRights[2] = false;
        this.castlingRights[3] = false;
      }
    }

    if (piece.type === PieceType.ROOK) {
      if (move.fromRow === 7 && move.fromCol === 7) this.castlingRights[0] = false;
      if (move.fromRow === 7 && move.fromCol === 0) this.castlingRights[1] = false;
      if (move.fromRow === 0 && move.fromCol === 7) this.castlingRights[2] = false;
      if (move.fromRow === 0 && move.fromCol === 0) this.castlingRights[3] = false;
    }

    // Castling rook captured
    if (move.toRow === 7 && move.toCol === 7) this.castlingRights[0] = false;
    if (move.toRow === 7 && move.toCol === 0) this.castlingRights[1] = false;
    if (move.toRow === 0 && move.toCol === 7) this.castlingRights[2] = false;
    if (move.toRow === 0 && move.toCol === 0) this.castlingRights[3] = false;

    // Move the piece (handles promotion)
    this.squares[move.toRow][move.toCol] = move.promotion ? 
      { type: move.promotion, color: piece.color } : piece;
    this.squares[move.fromRow][move.fromCol] = null;

    if (isEnPassant) {
      const capturedRow = piece.color === PieceColor.WHITE ? move.toRow + 1 : move.toRow - 1;
      this.squares[capturedRow][move.toCol] = null;
    }

    if (isCastle) {
      if (move.toCol === 6) { // Kingside
        this.squares[move.toRow][5] = this.squares[move.toRow][7];
        this.squares[move.toRow][7] = null;
      } else { // Queenside
        this.squares[move.toRow][3] = this.squares[move.toRow][0];
        this.squares[move.toRow][0] = null;
      }
    }

    this.currentTurn = this.opponent(this.currentTurn);
    const key = this.positionKey();
    this.positionHistory[key] = (this.positionHistory[key] || 0) + 1;
  }

  opponent(color) {
    return color === PieceColor.WHITE ? PieceColor.BLACK : PieceColor.WHITE;
  }

  isInCheck(color) {
    const king = this.findKing(color);
    if (!king) return false;
    return this.isAttackedBy(king.row, king.col, this.opponent(color));
  }

  findKing(color) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.squares[r][c];
        if (p && p.type === PieceType.KING && p.color === color) {
          return { row: r, col: c };
        }
      }
    }
    return null;
  }

  isAttackedBy(row, col, byColor) {
    // Knights
    const knightOffsets = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1]
    ];
    for (const [dr, dc] of knightOffsets) {
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const p = this.squares[r][c];
        if (p && p.color === byColor && p.type === PieceType.KNIGHT) return true;
      }
    }

    // King
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = row + dr;
        const c = col + dc;
        if (r >= 0 && r < 8 && c >= 0 && c < 8) {
          const p = this.squares[r][c];
          if (p && p.color === byColor && p.type === PieceType.KING) return true;
        }
      }
    }

    // Pawns
    const pawnDir = byColor === PieceColor.WHITE ? 1 : -1;
    for (const dc of [-1, 1]) {
      const r = row + pawnDir;
      const c = col + dc;
      if (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const p = this.squares[r][c];
        if (p && p.color === byColor && p.type === PieceType.PAWN) return true;
      }
    }

    // Rooks / Queens (Orthogonal)
    const orthoDirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dr, dc] of orthoDirs) {
      let r = row + dr;
      let c = col + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const p = this.squares[r][c];
        if (p) {
          if (p.color === byColor && (p.type === PieceType.ROOK || p.type === PieceType.QUEEN)) return true;
          break;
        }
        r += dr;
        c += dc;
      }
    }

    // Bishops / Queens (Diagonal)
    const diagDirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [dr, dc] of diagDirs) {
      let r = row + dr;
      let c = col + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const p = this.squares[r][c];
        if (p) {
          if (p.color === byColor && (p.type === PieceType.BISHOP || p.type === PieceType.QUEEN)) return true;
          break;
        }
        r += dr;
        c += dc;
      }
    }

    return false;
  }

  legalMovesFrom(row, col) {
    const piece = this.squares[row][col];
    if (!piece) return [];
    return this.pseudoFrom(row, col, piece).filter(move => {
      const c = this.copy();
      c.applyChessMove(move);
      return !c.isInCheck(piece.color);
    });
  }

  legalMoves(color) {
    const moves = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (this.squares[r][c] && this.squares[r][c].color === color) {
          moves.push(...this.legalMovesFrom(r, c));
        }
      }
    }
    return moves;
  }

  pseudoFrom(row, col, piece) {
    switch (piece.type) {
      case PieceType.PAWN:
        return this.pawnMoves(row, col, piece.color);
      case PieceType.KNIGHT:
        return this.knightMoves(row, col, piece.color);
      case PieceType.BISHOP:
        return this.sliding(row, col, piece.color, [[1, 1], [1, -1], [-1, 1], [-1, -1]]);
      case PieceType.ROOK:
        return this.sliding(row, col, piece.color, [[0, 1], [0, -1], [1, 0], [-1, 0]]);
      case PieceType.QUEEN:
        return this.sliding(row, col, piece.color, [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]);
      case PieceType.KING:
        return this.kingMoves(row, col, piece.color);
      default:
        return [];
    }
  }

  pawnMoves(row, col, color) {
    const moves = [];
    const dir = color === PieceColor.WHITE ? -1 : 1;
    const startRow = color === PieceColor.WHITE ? 6 : 1;
    const promoRow = color === PieceColor.WHITE ? 0 : 7;

    const add = (tr, tc) => {
      if (tr === promoRow) {
        for (const p of [PieceType.QUEEN, PieceType.ROOK, PieceType.BISHOP, PieceType.KNIGHT]) {
          moves.push(new ChessMove(row, col, tr, tc, p));
        }
      } else {
        moves.push(new ChessMove(row, col, tr, tc));
      }
    };

    const r1 = row + dir;
    if (r1 >= 0 && r1 < 8 && this.squares[r1][col] === null) {
      add(r1, col);
      if (row === startRow && this.squares[row + 2 * dir][col] === null) {
        moves.push(new ChessMove(row, col, row + 2 * dir, col));
      }
    }

    for (const dc of [-1, 1]) {
      const c = col + dc;
      if (r1 >= 0 && r1 < 8 && c >= 0 && c < 8) {
        const target = this.squares[r1][c];
        const ep = this.enPassantTarget && this.enPassantTarget.row === r1 && this.enPassantTarget.col === c;
        if ((target && target.color !== color) || ep) {
          add(r1, c);
        }
      }
    }
    return moves;
  }

  knightMoves(row, col, color) {
    const moves = [];
    const offsets = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1]
    ];
    for (const [dr, dc] of offsets) {
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const p = this.squares[r][c];
        if (!p || p.color !== color) {
          moves.push(new ChessMove(row, col, r, c));
        }
      }
    }
    return moves;
  }

  sliding(row, col, color, dirs) {
    const moves = [];
    for (const [dr, dc] of dirs) {
      let r = row + dr;
      let c = col + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const target = this.squares[r][c];
        if (target === null) {
          moves.push(new ChessMove(row, col, r, c));
        } else {
          if (target.color !== color) {
            moves.push(new ChessMove(row, col, r, c));
          }
          break;
        }
        r += dr;
        c += dc;
      }
    }
    return moves;
  }

  kingMoves(row, col, color) {
    const moves = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = row + dr;
        const c = col + dc;
        if (r >= 0 && r < 8 && c >= 0 && c < 8) {
          const p = this.squares[r][c];
          if (!p || p.color !== color) {
            moves.push(new ChessMove(row, col, r, c));
          }
        }
      }
    }

    const rank = color === PieceColor.WHITE ? 7 : 0;
    const oppColor = this.opponent(color);
    const ksRight = color === PieceColor.WHITE ? this.castlingRights[0] : this.castlingRights[2];
    const qsRight = color === PieceColor.WHITE ? this.castlingRights[1] : this.castlingRights[3];

    if (row === rank && col === 4 && !this.isInCheck(color)) {
      if (ksRight && this.squares[rank][5] === null && this.squares[rank][6] === null &&
          !this.isAttackedBy(rank, 5, oppColor) && !this.isAttackedBy(rank, 6, oppColor)) {
        moves.push(new ChessMove(row, col, rank, 6));
      }
      if (qsRight && this.squares[rank][3] === null && this.squares[rank][2] === null && this.squares[rank][1] === null &&
          !this.isAttackedBy(rank, 3, oppColor) && !this.isAttackedBy(rank, 2, oppColor)) {
        moves.push(new ChessMove(row, col, rank, 2));
      }
    }
    return moves;
  }

  gameResult() {
    if (this.findKing(PieceColor.WHITE) === null) return GameResult.CHECKMATE_BLACK_WINS;
    if (this.findKing(PieceColor.BLACK) === null) return GameResult.CHECKMATE_WHITE_WINS;
    
    if (Object.values(this.positionHistory).some(v => v >= 3)) return GameResult.DRAW_THREEFOLD;
    if (this.halfMoveClock >= 100) return GameResult.DRAW_FIFTY_MOVE;
    if (this.isInsufficientMaterial()) return GameResult.DRAW_INSUFFICIENT;

    if (this.legalMoves(this.currentTurn).length === 0) {
      if (this.isInCheck(this.currentTurn)) {
        return this.currentTurn === PieceColor.WHITE ? 
          GameResult.CHECKMATE_BLACK_WINS : GameResult.CHECKMATE_WHITE_WINS;
      } else {
        return GameResult.STALEMATE;
      }
    }
    return GameResult.ONGOING;
  }

  isInsufficientMaterial() {
    const all = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (this.squares[r][c]) all.push(this.squares[r][c]);
      }
    }

    if (all.length === 2) return true; // Kings only
    if (all.length === 3 && all.some(p => p.type === PieceType.KNIGHT || p.type === PieceType.BISHOP)) return true;
    
    if (all.length === 4) {
      const bishops = all.filter(p => p.type === PieceType.BISHOP);
      if (bishops.length === 2 && bishops[0].color !== bishops[1].color) {
        const pos = [];
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            if (this.squares[r][c] && this.squares[r][c].type === PieceType.BISHOP) {
              pos.push({ r, c });
            }
          }
        }
        if (pos.length === 2 && (pos[0].r + pos[0].c) % 2 === (pos[1].r + pos[1].c) % 2) {
          return true;
        }
      }
    }
    return false;
  }

  positionKey() {
    const sb = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.squares[r][c];
        if (!p) {
          sb.push('.');
        } else {
          const isWhite = p.color === PieceColor.WHITE;
          const char = {
            [PieceType.KING]: 'k',
            [PieceType.QUEEN]: 'q',
            [PieceType.ROOK]: 'r',
            [PieceType.BISHOP]: 'b',
            [PieceType.KNIGHT]: 'n',
            [PieceType.PAWN]: 'p'
          }[p.type];
          sb.push(isWhite ? char.toUpperCase() : char.toLowerCase());
        }
      }
    }
    sb.push(this.currentTurn === PieceColor.WHITE ? 'w' : 'b');
    this.castlingRights.forEach(r => sb.push(r ? '1' : '0'));
    if (this.enPassantTarget) {
      sb.push(`${this.enPassantTarget.row}${this.enPassantTarget.col}`);
    } else {
      sb.push('-');
    }
    return sb.join('');
  }

  copy() {
    const c = new ChessBoard();
    for (let r = 0; r < 8; r++) {
      for (let col = 0; col < 8; col++) {
        c.squares[r][col] = this.squares[r][col];
      }
    }
    c.castlingRights = [...this.castlingRights];
    c.enPassantTarget = this.enPassantTarget ? { ...this.enPassantTarget } : null;
    c.halfMoveClock = this.halfMoveClock;
    c.currentTurn = this.currentTurn;
    c.positionHistory = {};
    return c;
  }
}

const PIECE_VALUES = {
  [PieceType.PAWN]: 100,
  [PieceType.KNIGHT]: 320,
  [PieceType.BISHOP]: 330,
  [PieceType.ROOK]: 500,
  [PieceType.QUEEN]: 900,
  [PieceType.KING]: 20000
};

const PAWN_TABLE = [
  0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5,  5, 10, 25, 25, 10,  5,  5,
  0,  0,  0, 20, 20,  0,  0,  0,
  5, -5,-10,  0,  0,-10, -5,  5,
  5, 10, 10,-20,-20, 10, 10,  5,
  0,  0,  0,  0,  0,  0,  0,  0
];

const KNIGHT_TABLE = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50
];

const BISHOP_TABLE = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20
];

const ROOK_TABLE = [
  0,  0,  0,  0,  0,  0,  0,  0,
  5, 10, 10, 10, 10, 10, 10,  5,
 -5,  0,  0,  0,  0,  0,  0, -5,
 -5,  0,  0,  0,  0,  0,  0, -5,
 -5,  0,  0,  0,  0,  0,  0, -5,
 -5,  0,  0,  0,  0,  0,  0, -5,
 -5,  0,  0,  0,  0,  0,  0, -5,
  0,  0,  0,  5,  5,  0,  0,  0
];

export const BotEngine = {
  evaluateBoard(board) {
    let score = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board.squares[r][c];
        if (!piece) continue;
        const valBase = PIECE_VALUES[piece.type] || 0;
        
        const tableIndex = piece.color === PieceColor.WHITE ? (7 - r) * 8 + c : r * 8 + c;
        let posBonus = 0;
        if (piece.type === PieceType.PAWN) posBonus = PAWN_TABLE[tableIndex];
        else if (piece.type === PieceType.KNIGHT) posBonus = KNIGHT_TABLE[tableIndex];
        else if (piece.type === PieceType.BISHOP) posBonus = BISHOP_TABLE[tableIndex];
        else if (piece.type === PieceType.ROOK) posBonus = ROOK_TABLE[tableIndex];

        const totalVal = valBase + posBonus;
        if (piece.color === PieceColor.WHITE) {
          score += totalVal;
        } else {
          score -= totalVal;
        }
      }
    }
    return score;
  },

  minimax(board, depth, alpha, beta, isMaximizing) {
    const result = board.gameResult();
    if (result !== GameResult.ONGOING) {
      if (result === GameResult.CHECKMATE_WHITE_WINS) return [100000 + depth, null];
      if (result === GameResult.CHECKMATE_BLACK_WINS) return [-100000 - depth, null];
      return [0, null]; // Draws
    }

    if (depth === 0) {
      return [this.evaluateBoard(board), null];
    }

    const turn = isMaximizing ? PieceColor.WHITE : PieceColor.BLACK;
    const moves = board.legalMoves(turn);

    if (moves.length === 0) {
      return [isMaximizing ? -100000 : 100000, null];
    }

    // Sort moves: simple move ordering (captures first)
    const orderedMoves = [...moves].sort((mA, mB) => {
      const targetA = board.squares[mA.toRow][mA.toCol];
      const targetB = board.squares[mB.toRow][mB.toCol];
      const valA = targetA ? (PIECE_VALUES[targetA.type] || 0) : 0;
      const valB = targetB ? (PIECE_VALUES[targetB.type] || 0) : 0;
      return valB - valA;
    });

    let bestMove = null;
    if (isMaximizing) {
      let maxEval = -Infinity;
      let currentAlpha = alpha;
      for (const move of orderedMoves) {
        const nextBoard = board.copy();
        nextBoard.applyChessMove(move);
        const [evalVal] = this.minimax(nextBoard, depth - 1, currentAlpha, beta, false);
        if (evalVal > maxEval) {
          maxEval = evalVal;
          bestMove = move;
        }
        currentAlpha = Math.max(currentAlpha, evalVal);
        if (beta <= currentAlpha) break;
      }
      return [maxEval, bestMove];
    } else {
      let minEval = Infinity;
      let currentBeta = beta;
      for (const move of orderedMoves) {
        const nextBoard = board.copy();
        nextBoard.applyChessMove(move);
        const [evalVal] = this.minimax(nextBoard, depth - 1, alpha, currentBeta, true);
        if (evalVal < minEval) {
          minEval = evalVal;
          bestMove = move;
        }
        currentBeta = Math.min(currentBeta, evalVal);
        if (currentBeta <= alpha) break;
      }
      return [minEval, bestMove];
    }
  },

  getBestMove(board, color, depth = 3) {
    const isMaximizing = color === PieceColor.WHITE;
    const legal = board.legalMoves(color);
    if (legal.length === 0) return null;
    if (legal.length === 1) return legal[0];

    const searchDepth = legal.length > 25 ? depth - 1 : depth;

    // Evaluate each legal move at searchDepth - 1
    const moveEvaluations = legal.map(move => {
      const nextBoard = board.copy();
      nextBoard.applyChessMove(move);
      const [evalVal] = this.minimax(nextBoard, searchDepth - 1, -Infinity, Infinity, !isMaximizing);
      // If color is White, higher score is better. If Black, lower score is better.
      const relativeScore = isMaximizing ? evalVal : -evalVal;
      return { move, score: relativeScore };
    });

    // Sort by best moves first (descending relative score)
    moveEvaluations.sort((a, b) => b.score - a.score);

    // If the top move is a checkmate / king vaporization (highly forced), play it immediately
    if (moveEvaluations[0].score >= 90000) {
      return moveEvaluations[0].move;
    }

    // Take top choices (up to top 7 moves)
    const numChoices = Math.min(7, moveEvaluations.length);
    const topChoices = moveEvaluations.slice(0, numChoices);

    // Compute Boltzmann (Softmax) weights based on score difference from the best choice
    // Temperature is 40.0 centipawns. Ensures that moves that are close in score
    // have nearly equal chance, while blunders/suboptimal moves scale down exponentially.
    const bestScore = topChoices[0].score;
    const weights = topChoices.map(c => {
      const diff = bestScore - c.score; // diff >= 0
      const weight = Math.exp(-diff / 40.0);
      return { move: c.move, weight };
    });

    const totalWeight = weights.reduce((acc, w) => acc + w.weight, 0);

    // Weighted random sampling
    let rand = Math.random() * totalWeight;
    for (const item of weights) {
      rand -= item.weight;
      if (rand <= 0) {
        return item.move;
      }
    }

    return topChoices[0].move;
  },

  getWeightedPrediction(board, playerColor) {
    const playerMoves = board.legalMoves(playerColor);
    if (playerMoves.length === 0) return "";

    const isPlayerWhite = playerColor === PieceColor.WHITE;

    // Pair each move with its evaluation after the player makes it
    const moveEvaluations = playerMoves.map(move => {
      const nextBoard = board.copy();
      nextBoard.applyChessMove(move);
      const score = this.evaluateBoard(nextBoard);
      // If player is White, higher score is better for them. If Black, lower score is better.
      const relativeScore = isPlayerWhite ? score : -score;
      return { move, score: relativeScore };
    });

    // Sort by player's best moves first (descending relative score)
    moveEvaluations.sort((a, b) => b.score - a.score);

    // Take top moves (up to top 5)
    const numChoices = Math.min(5, moveEvaluations.length);
    const topChoices = moveEvaluations.slice(0, numChoices);

    // Assign weights. Shift scores to positive
    const minScore = topChoices[topChoices.length - 1].score;
    const shiftedScores = topChoices.map(c => ({
      move: c.move,
      shifted: Math.max(1, c.score - minScore + 10)
    }));

    // Square scores to heavily weight towards absolute best choices
    const weights = shiftedScores.map(s => ({
      move: s.move,
      weight: s.shifted * s.shifted
    }));
    const totalWeight = weights.reduce((acc, w) => acc + w.weight, 0);

    // Sample based on weights
    let rand = Math.random() * totalWeight;
    for (const item of weights) {
      rand -= item.weight;
      if (rand <= 0) {
        return item.move.toUci();
      }
    }

    return topChoices[0].move.toUci();
  }
};
