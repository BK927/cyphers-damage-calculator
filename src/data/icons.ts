// 캐릭터 slug → 넥슨 아이콘 번호 (resource.cyphers.co.kr/ui/img/character/ico_23px_{N}.jpg)
// 번호가 로스터 순서와 다르게 매겨져 있어(중간 결번 존재) 로스터 <img> src에서 직접 수집.
export const iconNum: Record<string, number> = {
  loras: 0, huton: 1, louis: 2, tara: 3, trivia: 4, cain: 5, rena: 6, drexler: 7,
  doyle: 8, thomas: 9, niobe: 10, shiva: 11, wesley: 12, stella: 13, alicia: 14,
  clare: 15, deimus: 16, eagle: 17, marlene: 18, charlotte: 19, willard: 20,
  lleyton: 21, michelle: 22, rin: 23, viktor: 24, carlos: 25, hotaru: 26, trixie: 27,
  ricardo: 28, camille: 29, jannette: 30, peter: 31, issac: 32, rebecca: 33, ellie: 34,
  martin: 35, bruce: 36, mia: 37, denise: 38, gereon: 39, lucy: 40, tian: 41, harang: 42,
  j: 43, belzer: 44, richel: 46, risa: 47, rick: 48, jekiel: 49, tanya: 50, carol: 51,
  lysander: 52, ludwig: 53, melvin: 54, diana: 55, clive: 56, helena: 57, eva: 58,
  ron: 60, leonor: 61, sidney: 62, tei: 63, timothy: 64, elfriede: 65, tisha: 66,
  carocho: 67, ryan: 68, watcher: 69, emily: 70, florian: 71, kenneth: 72, isabelle: 73,
  renato: 74, suki: 75, greta: 76, bastian: 77, january: 78, nicolas: 79, chiara: 80,
  veronica: 81, giuseppe: 82, luka: 83, angie: 84, endeka: 85,
}
