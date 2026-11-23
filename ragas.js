/* Swara Lens - raga data.
 *
 * Swarasthana indices: 0 S, 1 R1, 2 R2 (=G1), 3 R3 (=G2), 4 G3, 5 M1, 6 M2, 7 P, 8 D1, 9 D2 (=N1), 10 D3 (=N2), 11 N3
 *
 * The 72 melakartas are GENERATED from the chakra rule, not typed by hand, so their note sets are exact.
 * Janyas are listed by hand below with their arohana / avarohana. That list is a starter set written
 * without a guru's review: check it, correct it and extend it. Adding a raga is one line.
 *
 * Each raga ends up with:
 *   notes    all swarasthanas it uses (sorted indices)
 *   aroSet   swaras that may be ARRIVED at while ascending      avaSet  same for descending
 * Ragas that share exactly the same notes cannot be separated by pitch usage; the app groups them.
 */
(function (root) {
  const IDX = { S: 0, R1: 1, R2: 2, R3: 3, G1: 2, G2: 3, G3: 4, M1: 5, M2: 6, P: 7, D1: 8, D2: 9, D3: 10, N1: 9, N2: 10, N3: 11 };

  // Popular name first; the formal melakarta name goes in `aka` when it differs.
  const MELA = ['Kanakangi', 'Ratnangi', 'Ganamurti', 'Vanaspati', 'Manavati', 'Tanarupi', 'Senavati', 'Hanumatodi', 'Dhenuka', 'Natakapriya',
    'Kokilapriya', 'Rupavati', 'Gayakapriya', 'Vakulabharanam', 'Mayamalavagowla', 'Chakravakam', 'Suryakantam', 'Hatakambari', 'Jhankaradhwani', 'Natabhairavi',
    'Keeravani', 'Kharaharapriya', 'Gourimanohari', 'Varunapriya', 'Mararanjani', 'Charukesi', 'Sarasangi', 'Harikambhoji', 'Sankarabharanam', 'Naganandini',
    'Yagapriya', 'Ragavardhini', 'Gangeyabhushani', 'Vagadheeswari', 'Sulini', 'Chalanata', 'Salagam', 'Jalarnavam', 'Jhalavarali', 'Navaneetam',
    'Pavani', 'Raghupriya', 'Gavambodhi', 'Bhavapriya', 'Subhapantuvarali', 'Shadvidamargini', 'Suvarnangi', 'Divyamani', 'Dhavalambari', 'Namanarayani',
    'Kamavardhini', 'Ramapriya', 'Gamanashrama', 'Vishwambari', 'Shamalangi', 'Shanmukhapriya', 'Simhendramadhyamam', 'Hemavati', 'Dharmavati', 'Neetimati',
    'Kantamani', 'Rishabhapriya', 'Latangi', 'Vachaspati', 'Mechakalyani', 'Chitrambari', 'Sucharitra', 'Jyotiswarupini', 'Dhatuvardhani', 'Nasikabhushani',
    'Kosalam', 'Rasikapriya'];
  const AKA = { 29: 'Dheerasankarabharanam', 39: 'also called Varali', 51: 'Pantuvarali', 53: 'Purvikalyani', 65: 'Kalyani', 8: 'Todi', 23: 'Gowrimanohari', 45: 'Shubhapantuvarali' };
  const RELATED = {
    29: 'Begada, Kedaragowla and Atana use these notes, so a phrase in them can also be one of those ragas.',
    28: 'Behag also uses these notes.',
    22: 'Kapi and Ritigowla also use these notes.',
    20: 'Anandabhairavi also uses these notes.',
    65: 'Hamirkalyani and Yamunakalyani also use these notes.',
  };
  const ORD = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

  // chakra rule: 12 chakras of 6; first six have M1, next six M2; chakra picks (Ri, Ga), position picks (Da, Ni)
  const RG = [['R1', 'G1'], ['R1', 'G2'], ['R1', 'G3'], ['R2', 'G2'], ['R2', 'G3'], ['R3', 'G3']];
  const DN = [['D1', 'N1'], ['D1', 'N2'], ['D1', 'N3'], ['D2', 'N2'], ['D2', 'N3'], ['D3', 'N3']];
  function melaNames(n) {
    const c = Math.floor((n - 1) / 6), p = (n - 1) % 6;
    return ['S', RG[c % 6][0], RG[c % 6][1], c < 6 ? 'M1' : 'M2', 'P', DN[p][0], DN[p][1]];
  }

  // "S R2 G3 P D2 S'" -> indices; a trailing ' is the upper octave (same swara index)
  const seq = (str) => str.trim().split(/\s+/).map((t) => IDX[t.replace("'", '')]);
  function make(name, aro, ava, extra) {
    const a = seq(aro), d = seq(ava);
    const notes = Array.from(new Set(a.concat(d))).sort((x, y) => x - y);
    return Object.assign({ name, aro, ava, notes, aroSet: Array.from(new Set(a)), avaSet: Array.from(new Set(d)) }, extra);
  }

  const R = [];
  for (let n = 1; n <= 72; n++) {
    const nm = melaNames(n), up = nm.join(' ') + " S'", down = "S' " + nm.slice().reverse().join(' ');
    R.push(make(MELA[n - 1], up, down, { kind: 'melakarta', num: n, mela: ORD(n) + ' melakarta', aka: AKA[n] || null, related: RELATED[n] || null }));
  }

  // [name, parent melakarta or 0, arohana, avarohana]
  const J = [
    ['Mohanam', 28, "S R2 G3 P D2 S'", "S' D2 P G3 R2 S"],
    ['Hamsadhwani', 29, "S R2 G3 P N3 S'", "S' N3 P G3 R2 S"],
    ['Bilahari', 29, "S R2 G3 P D2 S'", "S' N3 D2 P M1 G3 R2 S"],
    ['Arabhi', 29, "S R2 M1 P D2 S'", "S' N3 D2 P M1 G3 R2 S"],
    ['Shuddha Saveri', 29, "S R2 M1 P D2 S'", "S' D2 P M1 R2 S"],
    ['Madhyamavati', 22, "S R2 M1 P N2 S'", "S' N2 P M1 R2 S"],
    ['Abhogi', 22, "S R2 G2 M1 D2 S'", "S' D2 M1 G2 R2 S"],
    ['Sri', 22, "S R2 M1 P N2 S'", "S' N2 P M1 R2 G2 R2 S"],
    ['Sri Ranjani', 22, "S R2 G2 M1 D2 N2 S'", "S' N2 D2 M1 G2 R2 S"],
    ['Shuddha Dhanyasi', 22, "S G2 M1 P N2 S'", "S' N2 P M1 G2 R2 S"],
    ['Dhanyasi', 8, "S G2 M1 P N2 S'", "S' N2 P M1 G2 R1 S"],
    ['Hindolam', 20, "S G2 M1 D1 N2 S'", "S' N2 D1 M1 G2 S"],
    ['Bhairavi', 20, "S R2 G2 M1 P D1 N2 S'", "S' N2 D1 P M1 G2 R2 S"],
    ['Kambhoji', 28, "S R2 G3 M1 P D2 S'", "S' N2 D2 P M1 G3 R2 S"],
    ['Khamas', 28, "S M1 G3 M1 P D2 N3 S'", "S' N2 D2 P M1 G3 R2 S"],
    ['Malahari', 15, "S R1 M1 P D1 S'", "S' D1 P M1 G3 R1 S"],
    ['Saveri', 15, "S R1 M1 P D1 S'", "S' N2 D1 P M1 G3 R1 S"],
    ['Bowli', 15, "S R1 G3 P D1 S'", "S' N3 D1 P G3 R1 S"],
    ['Bhoopalam', 8, "S R1 G2 P D1 S'", "S' D1 P G2 R1 S"],
    ['Revati', 0, "S R1 M1 P N2 S'", "S' N2 P M1 R1 S"],
    ['Revagupti', 0, "S R1 M1 P D2 S'", "S' D2 P M1 R1 S"],
    ['Amritavarshini', 65, "S G3 M2 P N3 S'", "S' N3 P M2 G3 S"],
  ];
  for (const [name, parent, a, d] of J) {
    R.push(make(name, a, d, { kind: 'janya', num: 0, mela: parent ? 'Janya of ' + parent + ' (' + MELA[parent - 1] + ')' : 'Janya raga', aka: null, related: null }));
  }

  root.RAGAS = R;
  if (typeof module === 'object' && module.exports) module.exports = R;
})(typeof self !== 'undefined' ? self : this);
