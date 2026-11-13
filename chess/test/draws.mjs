import { Chess } from '../node_modules/chess.js/dist/esm/chess.js';
const t=(n,c)=>console.log((c?'PASS':'FAIL')+'  '+n);
let c=new Chess('7k/8/6K1/8/8/8/8/5Q2 w - - 0 1'); c.move('Qf7'); t('stalemate', c.isStalemate()&&c.isGameOver());
c=new Chess(); for(const m of ['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1','Ng8']) c.move(m); t('threefold repetition', c.isThreefoldRepetition());
c=new Chess('8/8/8/4k3/8/8/2K5/8 w - - 0 1'); t('insufficient material (K v K)', c.isInsufficientMaterial());
c=new Chess('8/8/8/4k3/8/8/2K5/7R w - - 99 80'); c.move('Rh2'); t('50-move rule', c.isDrawByFiftyMoves());
c=new Chess('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3'); t('en passant legal', c.moves().includes('exf6'));
c=new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'); t('castling both sides', c.moves().includes('O-O')&&c.moves().includes('O-O-O'));
