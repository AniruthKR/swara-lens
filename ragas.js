/* A starter raga set. `notes` are swarasthana indices:
 * 0 S, 1 R1, 2 R2, 3 G2(=R3), 4 G3, 5 M1, 6 M2, 7 P, 8 D1, 9 D2, 10 N2(=D3), 11 N3
 * Ragas that share exactly the same notes cannot be told apart by pitch-class usage alone;
 * the app groups them and says so. Have a guru review this list before you publish it. */
(function (root) {
  const R = [
    { name: 'Sankarabharanam', mela: '29th melakarta', notes: [0, 2, 4, 5, 7, 9, 11], aro: "S R2 G3 M1 P D2 N3 S'", ava: "S' N3 D2 P M1 G3 R2 S", related: 'Bilahari, Begada and Arabhi use these notes (or a subset).' },
    { name: 'Kalyani', mela: '65th melakarta (Mechakalyani)', notes: [0, 2, 4, 6, 7, 9, 11], aro: "S R2 G3 M2 P D2 N3 S'", ava: "S' N3 D2 P M2 G3 R2 S" },
    { name: 'Kharaharapriya', mela: '22nd melakarta', notes: [0, 2, 3, 5, 7, 9, 10], aro: "S R2 G2 M1 P D2 N2 S'", ava: "S' N2 D2 P M1 G2 R2 S" },
    { name: 'Hanumatodi (Todi)', mela: '8th melakarta', notes: [0, 1, 3, 5, 7, 8, 10], aro: "S R1 G2 M1 P D1 N2 S'", ava: "S' N2 D1 P M1 G2 R1 S" },
    { name: 'Mayamalavagowla', mela: '15th melakarta', notes: [0, 1, 4, 5, 7, 8, 11], aro: "S R1 G3 M1 P D1 N3 S'", ava: "S' N3 D1 P M1 G3 R1 S" },
    { name: 'Natabhairavi', mela: '20th melakarta', notes: [0, 2, 3, 5, 7, 8, 10], aro: "S R2 G2 M1 P D1 N2 S'", ava: "S' N2 D1 P M1 G2 R2 S", related: 'Bhairavi and Anandabhairavi are janyas with the same notes.' },
    { name: 'Harikambhoji', mela: '28th melakarta', notes: [0, 2, 4, 5, 7, 9, 10], aro: "S R2 G3 M1 P D2 N2 S'", ava: "S' N2 D2 P M1 G3 R2 S", related: 'Kambhoji and Khamas are janyas.' },
    { name: 'Charukesi', mela: '26th melakarta', notes: [0, 2, 4, 5, 7, 8, 10], aro: "S R2 G3 M1 P D1 N2 S'", ava: "S' N2 D1 P M1 G3 R2 S" },
    { name: 'Keeravani', mela: '21st melakarta', notes: [0, 2, 3, 5, 7, 8, 11], aro: "S R2 G2 M1 P D1 N3 S'", ava: "S' N3 D1 P M1 G2 R2 S" },
    { name: 'Gourimanohari', mela: '23rd melakarta', notes: [0, 2, 3, 5, 7, 9, 11], aro: "S R2 G2 M1 P D2 N3 S'", ava: "S' N3 D2 P M1 G2 R2 S" },
    { name: 'Shanmukhapriya', mela: '56th melakarta', notes: [0, 2, 3, 6, 7, 8, 10], aro: "S R2 G2 M2 P D1 N2 S'", ava: "S' N2 D1 P M2 G2 R2 S" },
    { name: 'Simhendramadhyamam', mela: '57th melakarta', notes: [0, 2, 3, 6, 7, 8, 11], aro: "S R2 G2 M2 P D1 N3 S'", ava: "S' N3 D1 P M2 G2 R2 S" },
    { name: 'Dharmavati', mela: '59th melakarta', notes: [0, 2, 3, 6, 7, 9, 11], aro: "S R2 G2 M2 P D2 N3 S'", ava: "S' N3 D2 P M2 G2 R2 S" },
    { name: 'Mohanam', mela: 'Janya of 28 (Harikambhoji)', notes: [0, 2, 4, 7, 9], aro: "S R2 G3 P D2 S'", ava: "S' D2 P G3 R2 S" },
    { name: 'Hamsadhwani', mela: 'Janya of 29 (Sankarabharanam)', notes: [0, 2, 4, 7, 11], aro: "S R2 G3 P N3 S'", ava: "S' N3 P G3 R2 S" },
    { name: 'Madhyamavati', mela: 'Janya of 22 (Kharaharapriya)', notes: [0, 2, 5, 7, 10], aro: "S R2 M1 P N2 S'", ava: "S' N2 P M1 R2 S" },
    { name: 'Hindolam', mela: 'Janya of 20 (Natabhairavi)', notes: [0, 3, 5, 8, 10], aro: "S G2 M1 D1 N2 S'", ava: "S' N2 D1 M1 G2 S" },
    { name: 'Abhogi', mela: 'Janya of 22 (Kharaharapriya)', notes: [0, 2, 3, 5, 9], aro: "S R2 G2 M1 D2 S'", ava: "S' D2 M1 G2 R2 S" },
    { name: 'Shuddha Saveri', mela: 'Janya of 29 (Sankarabharanam)', notes: [0, 2, 5, 7, 9], aro: "S R2 M1 P D2 S'", ava: "S' D2 P M1 R2 S" },
    { name: 'Shree', mela: 'Janya of 22 (Kharaharapriya)', notes: [0, 2, 3, 5, 7, 10], aro: "S R2 M1 P N2 S'", ava: "S' N2 P M1 R2 G2 R2 S" },
    { name: 'Sri Ranjani', mela: 'Janya of 22 (Kharaharapriya)', notes: [0, 2, 3, 5, 9, 10], aro: "S R2 G2 M1 D2 N2 S'", ava: "S' N2 D2 M1 G2 R2 S" },
    { name: 'Malahari', mela: 'Janya of 15 (Mayamalavagowla)', notes: [0, 1, 4, 5, 7, 8], aro: "S R1 M1 P D1 S'", ava: "S' D1 P M1 G3 R1 S" },
  ];
  root.RAGAS = R;
  if (typeof module === 'object' && module.exports) module.exports = R;
})(typeof self !== 'undefined' ? self : this);
