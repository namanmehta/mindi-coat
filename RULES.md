# Mindi Coat House Rules (v1)

This is the specification the game engine implements. If the code and this file disagree, this file wins and the code is a bug.

## Words

* **Hand:** one round where each player plays one card (4 cards). The highest card takes the hand.
* **Match:** one full deal of 13 hands, won with 3 tens, or 2 tens and 7 hands.
* **Series:** best of 7 matches (first team to 4). Optional: no limit, just keep counting matches.

## Table

* 4 players, 2 teams. Partners sit opposite each other.
* Seats in play order (counterclockwise): A1, B1, A2, B2. Team A = A1 + A2, Team B = B1 + B2.
* "Right" of a player means the next player in play order (A1's right is B1).
* Standard 52 card deck. Ace is high: A K Q J 10 9 8 7 6 5 4 3 2.

## Start of a sitting

* A toss picks the first trump chooser at random.
* Dealing is automatic. The dealer seat is shown for flavor only and has no effect on play.

## Each match

1. **First deal.** Every player gets 5 cards.
2. **Trump choice.** The chooser looks at their own 5 cards and does one of:
   * **Name a suit.** Any of the four suits. It does not have to be in their hand.
   * **Go blind.** The chooser's own next 8 cards are shown face down. The chooser taps one. That card is revealed to all players, its suit becomes trump, and it stays in the chooser's hand.
3. **Trump is announced** to all players immediately in both cases.
4. **Second deal.** Every player gets 8 more cards (13 total). In a blind hand, the chooser's 8 are the same 8 they picked from.
5. **Play.** The chooser leads the first hand.
   * Players must follow the led suit if they can.
   * A player with no card of the led suit may play any card. Playing trump is optional.
   * The hand goes to the highest trump played. If no trump was played, it goes to the highest card of the led suit.
   * The winner of a hand leads the next hand.
6. **Match result.** A team wins the match the moment it holds either:
   * 3 or 4 tens, or
   * 2 tens and 7 or more hands.

   The match stops immediately when either condition is met. A tie is impossible: a 2 to 2 split of tens always leaves one team with 7+ hands by hand 13.
7. **Capturing all four tens** is a normal win (logged in the results table, no bonus).

## Next match

* The winning team always chooses trump next.
  * If the chooser's team **won**, the chooser's **partner** chooses next (A1 chose and won, so A2 chooses).
  * If the chooser's team **lost**, the player on the chooser's **right** chooses next (A1 chose and lost, so B1 chooses).

## Scoring and display

* **Live, during a match:** hands won per team, and which of the four tens (by suit) each team has taken. Current trump, whose turn.
* **After each hand:** the winning card is highlighted with "Name wins the hand", then the four cards slide toward the winner and the table clears.
* **Series:** matches won per team, first to 4. When a team reaches 4 it wins the series; a new series starts the count at 0. Series won are tallied. With "no limit", matches are just counted.
* **Team names:** each team names itself (up to 20 characters, must differ from the other team).
* **Results table:** one row per match: series, match number, chooser, trump suit, blind or named, winning team, tens per team, hands per team, whether it ended early.

## Players and disconnects

* Players join a private room with a display name and a room code. No accounts.
* Real players only. A seat is never filled by a bot.
* If a player disconnects, their seat is held for 2 minutes. During that time the game pauses for everyone.
* If they return, they resume with their full hand and the current state.
* If they do not return within 2 minutes, the game stays paused. A new player may take the empty seat (they receive the departed player's hand). Otherwise the table can be closed.
