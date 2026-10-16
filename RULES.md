# Mindi Coat House Rules (v1)

This is the specification the game engine implements. If the code and this file disagree, this file wins and the code is a bug.

## Table

* 4 players, 2 teams. Partners sit opposite each other.
* Seats in play order (counterclockwise): A1, B1, A2, B2. Team A = A1 + A2, Team B = B1 + B2.
* "Right" of a player means the next player in play order (A1's right is B1).
* Standard 52 card deck. Ace is high: A K Q J 10 9 8 7 6 5 4 3 2.

## Start of a sitting

* A toss picks the first trump chooser at random.
* Dealing is automatic. The dealer seat is shown for flavor only and has no effect on play.

## Each hand

1. **First deal.** Every player gets 5 cards.
2. **Trump choice.** The chooser looks at their own 5 cards and does one of:
   * **Name a suit.** Any of the four suits. It does not have to be in their hand.
   * **Go blind.** The chooser's own next 8 cards are shown face down. The chooser taps one. That card is revealed to all players, its suit becomes trump, and it stays in the chooser's hand.
3. **Trump is announced** to all players immediately in both cases.
4. **Second deal.** Every player gets 8 more cards (13 total). In a blind hand, the chooser's 8 are the same 8 they picked from.
5. **Play.** The chooser leads the first trick.
   * Players must follow the led suit if they can.
   * A player with no card of the led suit may play any card. Playing trump is optional.
   * The trick goes to the highest trump played. If no trump was played, it goes to the highest card of the led suit.
   * The trick winner leads the next trick.
6. **Hand result.** A team wins the hand the moment it holds either:
   * 3 or 4 tens, or
   * 2 tens and 7 or more tricks.

   The hand stops immediately when either condition is met. A tie is impossible: a 2 to 2 split of tens always leaves one team with 7+ tricks by trick 13.
7. **Capturing all four tens** is a normal win (logged in the results table, no bonus).

## Next hand

* The chooser passes to the right (A1, then B1, then A2, then B2, then A1...), regardless of who won.

## Scoring and display

* **Live, during a hand:** tens captured and tricks won per team, current trump, whose turn.
* **Across the sitting:** hands won per team.
* **Results table:** one row per hand: hand number, chooser, trump suit, blind or named, winning team, tens per team, tricks per team, whether it ended early.
* A sitting has no fixed end. It runs until players leave.

## Players and disconnects

* Players join a private room with a display name and a room code. No accounts.
* Real players only. A seat is never filled by a bot.
* If a player disconnects, their seat is held for 2 minutes. During that time the game pauses for everyone.
* If they return, they resume with their full hand and the current state.
* If they do not return within 2 minutes, the game stays paused. A new player may take the empty seat (they receive the departed player's hand). Otherwise the table can be closed.
